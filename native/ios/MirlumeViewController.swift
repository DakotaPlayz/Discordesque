import Capacitor

class MirlumeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MirlumeFileWriterPlugin())
    }
}
