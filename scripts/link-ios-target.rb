require 'xcodeproj'
project_path = 'ios/App/App.xcodeproj'
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == 'App' }
raise 'Capacitor App target not found' unless target
files = ['MirlumeFileWriterPlugin.swift','MirlumeViewController.swift']
files.each do |name|
  relative_path = 'App/' + name
  ref = project.files.find { |f| f.path == relative_path }
  ref ||= project.main_group.new_file(relative_path)
  unless target.source_build_phase.files_references.include?(ref)
    target.source_build_phase.add_file_reference(ref, true)
  end
end
project.save
puts 'Native Mirlume iOS files linked into App target.'
