import QtQuick

Rectangle {
    id: dock
    property var theme
    property string kernelState: "待接入"
    property bool kernelOnline: false

    signal viewRequested(string view)
    signal kernelRequested()
    signal photoRequested()

    width: 86
    color: theme ? theme.ink2 : "#efe7d7"
    border.width: 1
    border.color: theme ? theme.line : "#d8cbb6"

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: mouse.accepted = true
        z: -1
    }

    Column {
        anchors.fill: parent
        anchors.topMargin: 9
        anchors.leftMargin: 8
        anchors.rightMargin: 8
        spacing: 4

        Item {
            width: parent.width
            height: 50

            SpiritOrb {
                anchors.centerIn: parent
                width: 44
                height: 44
            }
        }

        Text {
            text: "场景"
            color: dock.theme ? dock.theme.dim : "#8a8070"
            font.family: dock.theme ? dock.theme.mono : "Cascadia Mono"
            font.pixelSize: 9
            font.letterSpacing: 1.4
            anchors.left: parent.left
            anchors.leftMargin: 8
            topPadding: 4
            bottomPadding: 2
        }

        DockButton {
            theme: dock.theme
            label: "透视"
            onClicked: dock.viewRequested("angle")
        }

        DockButton {
            theme: dock.theme
            label: "俯视"
            onClicked: dock.viewRequested("top")
        }

        DockButton {
            theme: dock.theme
            label: "仰视"
            onClicked: dock.viewRequested("low")
        }

        DockButton {
            theme: dock.theme
            label: "重置"
            onClicked: dock.viewRequested("reset")
        }

        Rectangle {
            width: parent.width
            height: 1
            color: dock.theme ? dock.theme.line : "#d8cbb6"
            anchors.left: parent.left
            anchors.leftMargin: 2
        }

        Text {
            text: "功能"
            color: dock.theme ? dock.theme.dim : "#8a8070"
            font.family: dock.theme ? dock.theme.mono : "Cascadia Mono"
            font.pixelSize: 9
            font.letterSpacing: 1.4
            anchors.left: parent.left
            anchors.leftMargin: 8
            topPadding: 4
            bottomPadding: 2
        }

        DockButton {
            theme: dock.theme
            label: "串口"
            meta: dock.kernelState
            online: dock.kernelOnline
            onClicked: dock.kernelRequested()
        }

        DockButton {
            theme: dock.theme
            label: "拍照"
            meta: "本地 / 内存"
            onClicked: dock.photoRequested()
        }

        Item {
            width: 1
            height: 1
        }

        Text {
            width: parent.width
            text: "C 内核\n串口已备"
            color: dock.theme ? dock.theme.dim : "#8a8070"
            font.family: dock.theme ? dock.theme.mono : "Cascadia Mono"
            font.pixelSize: 8
            lineHeight: 1.45
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
