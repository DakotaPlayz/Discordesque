package io.mirlume.chat;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Mirlume native streaming receiver. No Android save prompt is required.
 * Android 10+ uses MediaStore.Downloads/Mirlume with IS_PENDING until complete.
 * Legacy devices save to app-specific external Downloads.
 * The JS bridge sends small 16-KiB chunks; memory use is bounded.
 */
@CapacitorPlugin(name = "MirlumeFileWriter")
public class MirlumeFileWriter extends Plugin {
    private static final long MAX_BYTES = 20L * 1024L * 1024L * 1024L;
    private final Map<String, Record> writers = new HashMap<>();

    private static class Record {
        OutputStream stream;
        Uri uri;
        File file;
        long size;
        long written;
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        String provided = call.getString("filename", "download.bin");
        Double requested = call.getDouble("size");
        if (requested == null || requested < 1 || requested > MAX_BYTES || requested.longValue() != requested) {
            call.reject("Invalid transfer size.");
            return;
        }
        long expected = requested.longValue();
        String safe = provided.replaceAll("[\\\\/\\u0000-\\u001f]", "_");
        if (safe.length() > 120) safe = safe.substring(0, 120);
        if (safe.isEmpty()) safe = "download.bin";
        String suffix = "-" + UUID.randomUUID().toString().substring(0, 10);
        int dot = safe.lastIndexOf('.');
        if (dot > 0) safe = safe.substring(0, dot) + suffix + safe.substring(dot);
        else safe += suffix;

        Record rec = new Record();
        rec.size = expected;
        try {
            File disk = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (disk == null) disk = getContext().getFilesDir();
            StatFs fs = new StatFs(disk.getAbsolutePath());
            if (fs.getAvailableBytes() < expected + 100L * 1024L * 1024L) {
                call.reject("Not enough free space to auto-download this file.");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mirlume/");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                rec.uri = getContext().getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
                );
                if (rec.uri == null) throw new IOException("Unable to create a download file.");
                rec.stream = getContext().getContentResolver().openOutputStream(rec.uri, "w");
                if (rec.stream == null) throw new IOException("Unable to write the download file.");
            } else {
                File folder = new File(disk, "Mirlume");
                if (!folder.exists() && !folder.mkdirs()) throw new IOException("Unable to make downloads folder.");
                rec.file = new File(folder, safe + ".part");
                rec.stream = new FileOutputStream(rec.file, false);
            }
            String id = UUID.randomUUID().toString();
            writers.put(id, rec);
            JSObject result = new JSObject();
            result.put("id", id);
            result.put("filename", safe);
            result.put("location", "Downloads/Mirlume");
            call.resolve(result);
        } catch (Exception err) {
            closeQuietly(rec);
            deleteQuietly(rec);
            call.reject("Could not start download: " + err.getMessage());
        }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        String id = call.getString("id");
        Record rec = writers.get(id);
        if (rec == null) { call.reject("Unknown download."); return; }
        String base64 = call.getString("chunk");
        if (base64 == null || base64.length() > 100000) {
            call.reject("Invalid chunk."); return;
        }
        try {
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            if (rec.written + bytes.length > rec.size) throw new IOException("File exceeds announced size.");
            rec.stream.write(bytes);
            rec.written += bytes.length;
            JSObject response = new JSObject();
            response.put("written", rec.written);
            call.resolve(response);
        } catch (Exception err) {
            call.reject("Download write failed: " + err.getMessage());
        }
    }

    @PluginMethod
    public synchronized void finish(PluginCall call) {
        String id = call.getString("id");
        Record rec = writers.get(id);
        if (rec == null) { call.reject("Unknown download."); return; }
        if (rec.written != rec.size) { call.reject("File is incomplete."); return; }
        try {
            rec.stream.flush();
            rec.stream.close();
            rec.stream = null;
            if (rec.uri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(rec.uri, values, null, null);
            } else if (rec.file != null) {
                String pathname = rec.file.getAbsolutePath();
                File finalPath = new File(pathname.substring(0, pathname.length() - 5));
                if (!rec.file.renameTo(finalPath)) throw new IOException("Unable to finalize download.");
            }
            writers.remove(id);
            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("size", rec.written);
            call.resolve(result);
        } catch (Exception err) {
            call.reject("Could not finish download: " + err.getMessage());
        }
    }

    @PluginMethod
    public synchronized void cancel(PluginCall call) {
        Record rec = writers.remove(call.getString("id"));
        if (rec != null) {
            closeQuietly(rec);
            deleteQuietly(rec);
        }
        call.resolve();
    }

    private void closeQuietly(Record rec) {
        try { if (rec.stream != null) rec.stream.close(); }
        catch (Exception ignored) { }
        rec.stream = null;
    }

    private void deleteQuietly(Record rec) {
        try {
            if (rec.uri != null) getContext().getContentResolver().delete(rec.uri, null, null);
            if (rec.file != null) rec.file.delete();
        } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        for (Record rec : writers.values()) {
            closeQuietly(rec);
            deleteQuietly(rec);
        }
        writers.clear();
        super.handleOnDestroy();
    }
}
