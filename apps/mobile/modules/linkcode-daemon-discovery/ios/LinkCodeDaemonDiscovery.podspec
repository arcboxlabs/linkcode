Pod::Spec.new do |s|
  s.name           = 'LinkCodeDaemonDiscovery'
  s.version        = '1.0.0'
  s.summary        = 'LinkCode daemon discovery'
  s.description    = 'Browses for LinkCode daemons on the local network.'
  s.author         = 'ArcBox'
  s.homepage       = 'https://github.com/arcboxlabs/linkcode'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: 'https://github.com/arcboxlabs/linkcode.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
