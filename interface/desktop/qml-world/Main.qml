import QtQuick
import QtQuick.Window
import QtWebEngine

Window {
    id: root
    width: 1600
    height: 1000
    minimumWidth: 1100
    minimumHeight: 700
    visible: true
    visibility: Window.Maximized
    title: "Aevum World " + worldConfig.version
    color: "#050b12"

    property string sceneUrl: worldConfig.url

    Shortcut {
        sequence: "F11"
        onActivated: root.visibility = root.visibility === Window.FullScreen ? Window.Windowed : Window.FullScreen
    }

    WebEngineView {
        id: worldView
        anchors.fill: parent
        url: root.sceneUrl
        focus: true
        zoomFactor: 1.0
        backgroundColor: "#050b12"

        Component.onCompleted: forceActiveFocus()

        onLoadingChanged: function(request) {
            if (request.status === WebEngineView.LoadSucceededStatus) {
                worldView.runJavaScript(
                    "document.documentElement.classList.add('aevum-qml-world');" +
                    "document.body && (document.body.style.margin = '0');" +
                    "var c = document.querySelector('canvas'); if (c) { c.style.outline = 'none'; }",
                    function() {}
                );
                forceActiveFocus();
            } else if (request.status === WebEngineView.LoadFailedStatus) {
                console.error("world load failed", request.errorString);
            }
        }

        onRenderProcessTerminated: function(status, code) {
            console.error("world render process terminated", status, code);
            worldView.reload();
        }
    }
}
