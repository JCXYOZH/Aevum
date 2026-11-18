import QtQuick
import QtQuick.Window
import QtWebEngine

Window {
    id: root
    width: 1440
    height: 900
    minimumWidth: 980
    minimumHeight: 640
    visible: true
    title: "Aevum · 原生外壳"
    color: theme.ink

    property string sceneUrl: "http://127.0.0.1:8799/desktop.html?scene=1&qml=1"

    Theme { id: theme }

    function showToast(message) {
        toast.message = message;
        toast.visible = true;
        hideTimer.restart();
    }

    function callScene(code) {
        if (!webScene) return;
        webScene.runJavaScript(code, function(result) {});
    }

    function setView(name) {
        callScene("window.MemoriaScene && MemoriaScene.setView(" + JSON.stringify(name) + ");");
    }

    function capturePhoto() {
        webScene.runJavaScript(
            "window.MemoriaScene && typeof MemoriaScene.capturePhoto === 'function' ? MemoriaScene.capturePhoto() : ''",
            function(result) {
                if (!result) {
                    root.showToast("场景还没准备好，暂时不能拍照。");
                    return;
                }
                var path = photoSaver.saveDataUrl(result);
                root.showToast(path.length > 0 ? ("照片已保存 · " + path) : "照片保存失败。");
            }
        );
    }

    function injectQmlHost() {
        var code = [
            "(function () {",
            "  var style = document.getElementById('aevum-qml-host');",
            "  if (!style) {",
            "    style = document.createElement('style');",
            "    style.id = 'aevum-qml-host';",
            "    document.head.appendChild(style);",
            "  }",
            "  style.textContent = [",
            "    'html, body { background: #f6f0e3 !important; overflow: hidden !important; }',",
            "    '.topbar, .dock, .foot { display: none !important; }',",
            "    '.shell { display: block !important; height: 100% !important; }',",
            "    '.desk { position: fixed !important; inset: 0 !important; z-index: 1 !important; }',",
            "    '.desk__hint, .scene3d__tools, .scene3d__readout { display: none !important; }',",
            "    '.windows, .launchpad, .dialog { display: none !important; }'",
            "  ].join('\\n');",
            "  var desk = document.querySelector('.desk');",
            "  if (desk) desk.classList.add('scene-focus');",
            "  document.documentElement.classList.add('aevum-qml-host');",
            "  return true;",
            "})();"
        ].join("\n");
        webScene.runJavaScript(code, function(result) {});
    }

    WebEngineView {
        id: webScene
        anchors.fill: parent
        url: root.sceneUrl
        focus: true

        onLoadingChanged: function(loadRequest) {
            if (loadRequest.status === WebEngineView.LoadSucceededStatus) {
                root.injectQmlHost();
            } else if (loadRequest.status === WebEngineView.LoadFailedStatus) {
                root.showToast("3D 场景加载失败：请先确认 127.0.0.1:8799 正在运行。");
            }
        }

        onRenderProcessTerminated: function(status, code) {
            root.showToast("WebEngine 渲染进程退出，正在重新加载场景。");
            webScene.reload();
        }
    }

    AevumTopBar {
        id: topBar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        z: 12
        theme: theme
        bridgeOk: healthProbe.bridgeOk
        relayOk: healthProbe.relayOk
        trainerOk: healthProbe.trainerOk
        webOk: healthProbe.webOk
        onViewRequested: function(view) { root.setView(view); }
        onKernelRequested: {
            kernelDrawer.visible = true;
            kernelBridge.start();
        }
        onPhotoRequested: root.capturePhoto()
    }

    AevumDock {
        id: dock
        anchors.left: parent.left
        anchors.top: topBar.bottom
        anchors.bottom: footBar.top
        z: 12
        theme: theme
        kernelState: kernelBridge.state
        kernelOnline: kernelBridge.state === "已连接"
        onViewRequested: function(view) { root.setView(view); }
        onKernelRequested: {
            kernelDrawer.visible = true;
            kernelBridge.start();
        }
        onPhotoRequested: root.capturePhoto()
    }

    AevumFoot {
        id: footBar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        z: 12
        theme: theme
        online: healthProbe.online
        detail: healthProbe.detail
    }

    Rectangle {
        id: kernelDrawer
        visible: false
        z: 40
        width: 370
        height: 242
        anchors.right: parent.right
        anchors.rightMargin: 12
        anchors.top: topBar.bottom
        anchors.topMargin: 8
        color: theme.panel
        border.width: 1
        border.color: theme.line2

        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
            onPressed: mouse.accepted = true
            z: -1
        }

        Column {
            anchors.fill: parent
            anchors.margins: 14
            spacing: 8

            Item {
                width: parent.width
                height: 30

                Text {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    text: "C 内核 / 串口桥"
                    color: theme.text
                    font.family: theme.sans
                    font.pixelSize: 13
                    font.weight: Font.DemiBold
                }

                ShellButton {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    theme: theme
                    label: "关闭"
                    onClicked: kernelDrawer.visible = false
                }
            }

            Rectangle { width: parent.width; height: 1; color: theme.line }

            Text {
                width: parent.width
                text: "状态　" + kernelBridge.state
                color: kernelBridge.state === "已连接" ? theme.teal : theme.muted
                font.family: theme.mono
                font.pixelSize: 10
            }

            Text {
                width: parent.width
                text: "帧数　" + kernelBridge.frameCount + "　　单元　" + kernelBridge.lastCells
                color: theme.muted
                font.family: theme.mono
                font.pixelSize: 10
            }

            Text {
                width: parent.width
                text: "监听 QEMU 串口 127.0.0.1:5555，按 A5 5A 帧格式预留；只做数据桥，不嵌入内核窗口。"
                color: theme.dim
                font.family: theme.sans
                font.pixelSize: 10
                wrapMode: Text.WordWrap
                lineHeight: 1.35
            }

            Text {
                width: parent.width
                text: "下一步接 C 内核时，把 VGA 帧直接喂给原生面板或场景状态，不经过 HTML 窗口层。"
                color: theme.dim
                font.family: theme.sans
                font.pixelSize: 10
                wrapMode: Text.WordWrap
                lineHeight: 1.35
            }
        }
    }

    Rectangle {
        id: toast
        property string message: ""
        visible: false
        z: 50
        width: Math.min(560, messageText.implicitWidth + 28)
        height: 34
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: footBar.top
        anchors.bottomMargin: 14
        color: theme.panel
        border.width: 1
        border.color: theme.amber
        opacity: visible ? 1.0 : 0.0
        Behavior on opacity { NumberAnimation { duration: 140 } }

        Text {
            id: messageText
            anchors.centerIn: parent
            width: parent.width - 24
            text: toast.message
            color: theme.text
            font.family: theme.sans
            font.pixelSize: 11
            elide: Text.ElideRight
            horizontalAlignment: Text.AlignHCenter
        }
    }

    Timer {
        id: hideTimer
        interval: 3200
        repeat: false
        onTriggered: toast.visible = false
    }
}
