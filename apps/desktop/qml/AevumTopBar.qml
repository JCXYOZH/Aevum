import QtQuick

Rectangle {
    id: bar
    property var theme
    property bool bridgeOk: false
    property bool relayOk: false
    property bool trainerOk: false
    property bool webOk: false
    property bool healthPending: false

    signal viewRequested(string view)
    signal kernelRequested()
    signal photoRequested()

    height: 54
    color: theme ? theme.ink : "#f6f0e3"
    border.width: 1
    border.color: theme ? theme.line : "#d8cbb6"

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: mouse.accepted = true
        z: -1
    }

    Item {
        anchors.fill: parent
        anchors.leftMargin: 16
        anchors.rightMargin: 16

        Row {
            id: brand
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: 10

            Rectangle {
                width: 30
                height: 30
                color: bar.theme ? bar.theme.panel2 : "#fbf7ee"
                border.width: 1
                border.color: bar.theme ? bar.theme.line2 : "#c3b398"

                Text {
                    anchors.centerIn: parent
                    text: "A"
                    color: bar.theme ? bar.theme.amber : "#a9722d"
                    font.family: bar.theme ? bar.theme.mono : "Cascadia Mono"
                    font.pixelSize: 18
                }
            }

            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: -2

                Text {
                    text: "AEVUM"
                    color: bar.theme ? bar.theme.text : "#1c1a16"
                    font.family: bar.theme ? bar.theme.sans : "Bahnschrift"
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                    font.letterSpacing: 2.2
                }

                Text {
                    text: "MEMORIA / CONTROL DESK"
                    color: bar.theme ? bar.theme.dim : "#8a8070"
                    font.family: bar.theme ? bar.theme.mono : "Cascadia Mono"
                    font.pixelSize: 9
                    font.letterSpacing: 0.7
                }
            }
        }

        Row {
            id: statusRow
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            StatusPill { theme: bar.theme; label: "内核"; ok: bar.bridgeOk; pending: bar.healthPending }
            StatusPill { theme: bar.theme; label: "中继"; ok: bar.relayOk; pending: bar.healthPending }
            StatusPill { theme: bar.theme; label: "训练"; ok: bar.trainerOk; pending: bar.healthPending }
            StatusPill { theme: bar.theme; label: "页面"; ok: bar.webOk; pending: bar.healthPending }
        }

        Row {
            id: rightRow
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            Text {
                id: clock
                anchors.verticalCenter: parent.verticalCenter
                text: Qt.formatTime(new Date(), "HH:mm:ss")
                color: bar.theme ? bar.theme.muted : "#5f584b"
                font.family: bar.theme ? bar.theme.mono : "Cascadia Mono"
                font.pixelSize: 11
                horizontalAlignment: Text.AlignRight
                width: 78

                Timer {
                    interval: 1000
                    repeat: true
                    running: true
                    onTriggered: clock.text = Qt.formatTime(new Date(), "HH:mm:ss")
                }
            }

            ShellButton {
                theme: bar.theme
                label: "串口"
                onClicked: bar.kernelRequested()
            }

            ShellButton {
                theme: bar.theme
                label: "拍照"
                onClicked: bar.photoRequested()
            }

            ShellButton {
                theme: bar.theme
                label: "重置视角"
                solid: true
                onClicked: bar.viewRequested("reset")
            }
        }
    }
}
