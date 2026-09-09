import ExpoModulesCore
import Foundation
import Network

private let eventName = "onHostsChanged"
private let serviceType = "_linkcode._tcp"
// TODO: Verify daemon identity and carry its paired capability once the advert contract exists.

private struct DiscoveredDaemon {
  let id: String
  let name: String
  let host: String
  let port: Int
}

public final class LinkCodeDaemonDiscoveryModule: Module {
  private let queue = DispatchQueue(label: "ai.linkcode.daemon-discovery")
  private var browser: NWBrowser?
  private var connections: [String: NWConnection] = [:]
  private var resolutionTimeouts: [String: DispatchWorkItem] = [:]
  private var hosts: [String: DiscoveredDaemon] = [:]
  private var activeServiceIds = Set<String>()
  private var generation = 0
  private var isObserved = false
  private var status = "searching"
  private var errorCode: String?

  public func definition() -> ModuleDefinition {
    Name("LinkCodeDaemonDiscovery")

    Events(eventName)

    OnStartObserving(eventName) { [weak self] in
      self?.queue.async { [weak self] in
        self?.isObserved = true
        self?.startDiscovery()
      }
    }

    OnStopObserving(eventName) { [weak self] in
      self?.queue.async { [weak self] in
        self?.isObserved = false
        self?.stopDiscovery()
      }
    }

    OnAppEntersBackground { [weak self] in
      self?.queue.async { [weak self] in
        self?.stopDiscovery()
      }
    }

    OnAppEntersForeground { [weak self] in
      self?.queue.async { [weak self] in
        guard self?.isObserved == true else { return }
        self?.startDiscovery()
      }
    }

    OnDestroy { [weak self] in
      self?.queue.async { [weak self] in
        self?.stopDiscovery()
      }
    }
  }

  private func startDiscovery() {
    guard browser == nil else {
      emitSnapshot()
      return
    }

    generation += 1
    let currentGeneration = generation
    hosts.removeAll()
    activeServiceIds.removeAll()
    status = "searching"
    errorCode = nil
    emitSnapshot()

    let parameters = NWParameters.tcp
    parameters.includePeerToPeer = true
    parameters.allowLocalEndpointReuse = true

    let browser = NWBrowser(
      for: .bonjourWithTXTRecord(type: serviceType, domain: nil),
      using: parameters
    )
    self.browser = browser

    browser.stateUpdateHandler = { [weak self] state in
      self?.handleBrowserState(state, generation: currentGeneration)
    }
    browser.browseResultsChangedHandler = { [weak self] results, _ in
      self?.handleBrowseResults(results, generation: currentGeneration)
    }
    browser.start(queue: queue)
  }

  private func stopDiscovery() {
    generation += 1
    browser?.stateUpdateHandler = nil
    browser?.browseResultsChangedHandler = nil
    browser?.cancel()
    browser = nil
    connections.values.forEach { $0.cancel() }
    connections.removeAll()
    resolutionTimeouts.values.forEach { $0.cancel() }
    resolutionTimeouts.removeAll()
    hosts.removeAll()
    activeServiceIds.removeAll()
  }

  private func handleBrowserState(_ state: NWBrowser.State, generation: Int) {
    guard generation == self.generation else { return }

    switch state {
    case .ready:
      status = "ready"
      errorCode = nil
      emitSnapshot()
    case .waiting(let error):
      if case .dns(let dnsError) = error, dnsError == kDNSServiceErr_PolicyDenied {
        failDiscovery(with: "permissionDenied")
      }
    case .failed(let error):
      if case .dns(let dnsError) = error, dnsError == kDNSServiceErr_PolicyDenied {
        failDiscovery(with: "permissionDenied")
      } else {
        failDiscovery(with: "failed")
      }
    default:
      break
    }
  }

  private func handleBrowseResults(_ results: Set<NWBrowser.Result>, generation: Int) {
    guard generation == self.generation else { return }

    var indexedResults: [String: (String, NWEndpoint)] = [:]
    for result in results {
      guard case let .service(name, type, domain, interface) = result.endpoint else {
        continue
      }
      let id = [name, type, domain, interface?.name ?? ""].joined(separator: "|")
      indexedResults[id] = (name, result.endpoint)
    }
    activeServiceIds = Set(indexedResults.keys)

    for id in Array(hosts.keys) where !activeServiceIds.contains(id) {
      hosts.removeValue(forKey: id)
    }
    for id in Array(connections.keys) where !activeServiceIds.contains(id) {
      finishResolution(id: id, connection: connections[id])
    }
    emitSnapshot()

    for (id, service) in indexedResults where hosts[id] == nil && connections[id] == nil {
      resolveService(id: id, name: service.0, endpoint: service.1, generation: generation)
    }
  }

  private func resolveService(id: String, name: String, endpoint: NWEndpoint, generation: Int) {
    let parameters = NWParameters.tcp
    parameters.includePeerToPeer = true
    parameters.allowLocalEndpointReuse = true
    parameters.requiredInterface = endpoint.interface

    let connection = NWConnection(to: endpoint, using: parameters)
    connections[id] = connection
    let timeout = DispatchWorkItem { [weak self, weak connection] in
      guard let self, let connection, self.connections[id] === connection else { return }
      self.finishResolution(id: id, connection: connection)
    }
    resolutionTimeouts[id] = timeout
    connection.stateUpdateHandler = { [weak self, weak connection] state in
      guard let self, let connection else { return }
      self.handleConnectionState(
        state,
        connection: connection,
        id: id,
        name: name,
        generation: generation
      )
    }
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 5, execute: timeout)
  }

  private func handleConnectionState(
    _ state: NWConnection.State,
    connection: NWConnection,
    id: String,
    name: String,
    generation: Int
  ) {
    guard generation == self.generation, connections[id] === connection else {
      connection.cancel()
      return
    }

    switch state {
    case .ready:
      defer {
        finishResolution(id: id, connection: connection)
      }
      guard
        activeServiceIds.contains(id),
        let endpoint = connection.currentPath?.remoteEndpoint,
        case let .hostPort(host, port) = endpoint,
        let hostName = hostName(host)
      else {
        return
      }
      hosts[id] = DiscoveredDaemon(
        id: id,
        name: name,
        host: hostName,
        port: Int(port.rawValue)
      )
      emitSnapshot()
    case .failed, .cancelled:
      finishResolution(id: id, connection: connection)
    default:
      break
    }
  }

  private func finishResolution(id: String, connection: NWConnection?) {
    guard let connection, connections[id] === connection else { return }
    resolutionTimeouts.removeValue(forKey: id)?.cancel()
    connections.removeValue(forKey: id)
    connection.stateUpdateHandler = nil
    connection.cancel()
  }

  private func failDiscovery(with error: String) {
    browser?.stateUpdateHandler = nil
    browser?.browseResultsChangedHandler = nil
    browser?.cancel()
    browser = nil
    connections.values.forEach { $0.cancel() }
    connections.removeAll()
    resolutionTimeouts.values.forEach { $0.cancel() }
    resolutionTimeouts.removeAll()
    hosts.removeAll()
    activeServiceIds.removeAll()
    status = "error"
    errorCode = error
    emitSnapshot()
  }

  private func hostName(_ host: NWEndpoint.Host) -> String? {
    switch host {
    case .name(let name, _):
      return name
    case .ipv4(let address):
      return IPv4Address(address.rawValue)?.debugDescription
    case .ipv6(let address):
      return address.debugDescription
    @unknown default:
      return nil
    }
  }

  private func emitSnapshot() {
    let serializedHosts: [[String: Any]] = hosts.values
      .sorted { lhs, rhs in
        lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
      }
      .map { host in
        [
          "id": host.id,
          "name": host.name,
          "host": host.host,
          "port": host.port,
        ]
      }

    var payload: [String: Any] = [
      "status": status,
      "hosts": serializedHosts,
    ]
    if let errorCode {
      payload["error"] = errorCode
    }
    sendEvent(eventName, payload)
  }
}
