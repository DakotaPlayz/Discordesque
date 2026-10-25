import Capacitor

class MirlumeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MirlumeFileWriterPlugin())
    }
}
