package io.mirlume.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MirlumeFileWriter.class);
        super.onCreate(savedInstanceState);
    }
}
