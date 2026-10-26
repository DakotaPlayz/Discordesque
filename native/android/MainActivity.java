package io.mirlume.chat;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MirlumeFileWriter.class);
        super.onCreate(savedInstanceState);
        // SafeArea plugin handles WebView insets across Android WebView versions.
        // Enable real edge-to-edge so CSS env(safe-area-inset-*) can keep
        // controls clear of status bars, navigation gestures, and cutouts.
        EdgeToEdge.enable(this);
    }
}
