Pod::Spec.new do |s|
  s.name           = 'LinkCodeNavigationBarBackdrop'
  s.version        = '1.0.0'
  s.summary        = 'LinkCode navigation bar backdrop'
  s.description    = s.summary
  s.author         = 'ArcBox'
  s.homepage       = 'https://github.com/arcboxlabs/linkcode'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: 'https://github.com/arcboxlabs/linkcode.git' }
  s.static_framework = true

  s.dependency 'React-Core'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm}'
end
