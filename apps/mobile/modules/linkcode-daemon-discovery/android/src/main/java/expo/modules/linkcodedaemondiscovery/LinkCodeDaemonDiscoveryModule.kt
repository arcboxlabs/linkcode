package expo.modules.linkcodedaemondiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

private const val EVENT_NAME = "onHostsChanged"
private const val SERVICE_TYPE = "_linkcode._tcp."
private const val MULTICAST_LOCK_TAG = "LinkCodeDaemonDiscovery"

private data class DiscoveredDaemon(
  val id: String,
  val name: String,
  val host: String,
  val port: Int
)

class LinkCodeDaemonDiscoveryModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val hosts = mutableMapOf<String, DiscoveredDaemon>()
  private val activeServiceNames = mutableSetOf<String>()
  private val pendingServices = ArrayDeque<NsdServiceInfo>()

  private var manager: NsdManager? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private var generation = 0
  private var isObserved = false
  private var isInForeground = true
  private var isResolving = false
  private var status = "searching"
  private var errorCode: String? = null

  override fun definition() = ModuleDefinition {
    Name("LinkCodeDaemonDiscovery")

    Events(EVENT_NAME)

    OnStartObserving(EVENT_NAME) {
      handler.post {
        isObserved = true
        startDiscovery()
      }
    }

    OnStopObserving(EVENT_NAME) {
      handler.post {
        isObserved = false
        stopDiscovery()
      }
    }

    OnActivityEntersBackground {
      handler.post {
        isInForeground = false
        stopDiscovery()
      }
    }

    OnActivityEntersForeground {
      handler.post {
        isInForeground = true
        if (isObserved) {
          startDiscovery()
        }
      }
    }

    OnDestroy {
      handler.post {
        isObserved = false
        isInForeground = false
        stopDiscovery()
      }
    }
  }

  private fun startDiscovery() {
    if (discoveryListener != null) {
      emitSnapshot()
      return
    }

    val context = appContext.reactContext?.applicationContext
    val nsdManager = context?.getSystemService(Context.NSD_SERVICE) as? NsdManager
    if (context == null || nsdManager == null) {
      status = "error"
      errorCode = "unavailable"
      emitSnapshot()
      return
    }

    generation += 1
    val currentGeneration = generation
    manager = nsdManager
    hosts.clear()
    activeServiceNames.clear()
    pendingServices.clear()
    isResolving = false
    status = "searching"
    errorCode = null
    emitSnapshot()
    acquireMulticastLock(context)

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {
        handler.post {
          if (currentGeneration != generation) return@post
          status = "ready"
          errorCode = null
          emitSnapshot()
        }
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        handler.post {
          if (currentGeneration != generation) return@post
          val serviceName = serviceInfo.serviceName ?: return@post
          if (activeServiceNames.add(serviceName)) {
            pendingServices.addLast(serviceInfo)
            resolveNext(currentGeneration)
          }
        }
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        handler.post {
          if (currentGeneration != generation) return@post
          val serviceName = serviceInfo.serviceName ?: return@post
          activeServiceNames.remove(serviceName)
          if (hosts.remove(serviceName) != null) {
            emitSnapshot()
          }
        }
      }

      override fun onStartDiscoveryFailed(serviceType: String, error: Int) {
        handler.post {
          if (currentGeneration != generation) return@post
          discoveryListener = null
          status = "error"
          errorCode = "failed"
          releaseMulticastLock()
          emitSnapshot()
        }
      }

      override fun onStopDiscoveryFailed(serviceType: String, error: Int) {
        handler.post { retryStop(this) }
      }

      override fun onDiscoveryStopped(serviceType: String) {
        handler.post { completeStop(this) }
      }
    }

    discoveryListener = listener
    try {
      nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (_: SecurityException) {
      discoveryListener = null
      status = "error"
      errorCode = "permissionDenied"
      releaseMulticastLock()
      emitSnapshot()
    } catch (_: RuntimeException) {
      discoveryListener = null
      status = "error"
      errorCode = "failed"
      releaseMulticastLock()
      emitSnapshot()
    }
  }

  private fun stopDiscovery() {
    generation += 1
    val listener = discoveryListener
    isResolving = false
    pendingServices.clear()
    activeServiceNames.clear()
    hosts.clear()
    if (listener == null) {
      releaseMulticastLock()
    } else {
      requestStop(listener)
    }
  }

  private fun requestStop(listener: NsdManager.DiscoveryListener) {
    if (discoveryListener !== listener) return

    try {
      manager?.stopServiceDiscovery(listener)
    } catch (_: IllegalArgumentException) {
      completeStop(listener)
    } catch (_: SecurityException) {
      completeStop(listener)
    } catch (_: RuntimeException) {
      retryStop(listener)
    }
  }

  private fun retryStop(listener: NsdManager.DiscoveryListener) {
    if (discoveryListener !== listener) return
    handler.postDelayed({ requestStop(listener) }, 500)
  }

  private fun completeStop(listener: NsdManager.DiscoveryListener) {
    if (discoveryListener !== listener) return
    discoveryListener = null
    releaseMulticastLock()
    if (isObserved && isInForeground) {
      startDiscovery()
    }
  }

  // The executor-based resolver starts at API 34; this callback is required by the API 24 floor.
  @Suppress("DEPRECATION")
  private fun resolveNext(currentGeneration: Int) {
    if (isResolving || currentGeneration != generation) return

    val serviceInfo = pendingServices.pollFirst() ?: return
    val serviceName = serviceInfo.serviceName ?: run {
      resolveNext(currentGeneration)
      return
    }
    if (!activeServiceNames.contains(serviceName)) {
      resolveNext(currentGeneration)
      return
    }

    val nsdManager = manager ?: return
    isResolving = true
    try {
      nsdManager.resolveService(
        serviceInfo,
        object : NsdManager.ResolveListener {
          override fun onResolveFailed(serviceInfo: NsdServiceInfo, error: Int) {
            handler.post {
              if (currentGeneration != generation) return@post
              isResolving = false
              resolveNext(currentGeneration)
            }
          }

          override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
            handler.post {
              if (currentGeneration != generation) return@post
              isResolving = false
              val resolvedName = serviceInfo.serviceName ?: serviceName
              val host = serviceInfo.host?.hostAddress
              val port = serviceInfo.port
              if (
                activeServiceNames.contains(resolvedName) &&
                  !host.isNullOrBlank() &&
                  port in 1..65_535
              ) {
                hosts[resolvedName] = DiscoveredDaemon(
                  id = resolvedName,
                  name = resolvedName,
                  host = host,
                  port = port
                )
                emitSnapshot()
              }
              resolveNext(currentGeneration)
            }
          }
        }
      )
    } catch (_: SecurityException) {
      isResolving = false
      status = "error"
      errorCode = "permissionDenied"
      emitSnapshot()
    } catch (_: RuntimeException) {
      isResolving = false
      resolveNext(currentGeneration)
    }
  }

  private fun acquireMulticastLock(context: Context) {
    val wifiManager = context.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    multicastLock = wifiManager.createMulticastLock(MULTICAST_LOCK_TAG).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseMulticastLock() {
    multicastLock?.let { lock ->
      if (lock.isHeld) {
        lock.release()
      }
    }
    multicastLock = null
  }

  private fun emitSnapshot() {
    val serializedHosts = ArrayList(
      hosts.values
        .sortedBy { it.name.lowercase() }
        .map { host ->
          Bundle().apply {
            putString("id", host.id)
            putString("name", host.name)
            putString("host", host.host)
            putInt("port", host.port)
          }
        }
    )
    val payload = Bundle().apply {
      putString("status", status)
      putParcelableArrayList("hosts", serializedHosts)
      errorCode?.let { putString("error", it) }
    }
    sendEvent(EVENT_NAME, payload)
  }
}
