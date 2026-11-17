import QtQuick

Rectangle {
    id: button
    property var theme
    property string label: ""
    property string meta: ""
    property bool active: false
    property bool online: false
    signal clicked()

    width: parent ? parent.width : 68
    height: meta.length > 0 ? 48 : 38
    color: active || mouse.containsMouse
        ? (theme ? theme.panel : "#fffdf8")
        : "transparent"
    border.width: active || mouse.containsMouse ? 1 : 0
    border.color: theme ? theme.line2 : "#c3b398"

    Rectangle {
        id: marker
        width: 3
        height: 16
        anchors.left: parent.left
        anchors.leftMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        color: button.online
            ? (button.theme ? button.theme.teal : "#2f7c76")
            : (button.active ? (button.theme ? button.theme.amber : "#a9722d")
                             : (button.theme ? button.theme.dim : "#8a8070"))
        opacity: button.active || mouse.containsMouse ? 1.0 : 0.55
    }

    Column {
        anchors.left: marker.right
        anchors.leftMargin: 8
        anchors.right: parent.right
        anchors.rightMargin: 6
        anchors.verticalCenter: parent.verticalCenter
        spacing: 1

        Text {
            text: button.label
            color: button.active || mouse.containsMouse
                ? (button.theme ? button.theme.text : "#1c1a16")
                : (button.theme ? button.theme.muted : "#5f584b")
            font.family: button.theme ? button.theme.sans : "Bahnschrift"
            font.pixelSize: 11
            elide: Text.ElideRight
            width: parent.width
        }

        Text {
            visible: button.meta.length > 0
            text: button.meta
            color: button.theme ? button.theme.dim : "#8a8070"
            font.family: button.theme ? button.theme.mono : "Cascadia Mono"
            font.pixelSize: 8
            font.letterSpacing: 0.3
            elide: Text.ElideRight
            width: parent.width
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: button.clicked()
    }
}
