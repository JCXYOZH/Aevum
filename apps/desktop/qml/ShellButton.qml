import QtQuick

Rectangle {
    id: button
    property var theme
    property string label: ""
    property bool solid: false
    property bool enabled: true
    signal clicked()

    implicitWidth: labelText.implicitWidth + 22
    height: 30
    color: solid
        ? (theme ? theme.amber : "#a9722d")
        : (mouse.containsMouse ? (theme ? theme.panel : "#fffdf8")
                               : (theme ? theme.panel2 : "#fbf7ee"))
    border.width: 1
    border.color: solid
        ? (theme ? theme.amber : "#a9722d")
        : (mouse.containsMouse ? (theme ? theme.amber : "#a9722d")
                               : (theme ? theme.line : "#d8cbb6"))

    Text {
        id: labelText
        anchors.centerIn: parent
        text: button.label
        color: button.solid
            ? "#fffaf0"
            : (button.enabled
                ? (mouse.containsMouse ? (button.theme ? button.theme.amber : "#a9722d")
                                       : (button.theme ? button.theme.text : "#1c1a16"))
                : (button.theme ? button.theme.dim : "#8a8070"))
        font.family: button.theme ? button.theme.sans : "Bahnschrift"
        font.pixelSize: 12
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        enabled: button.enabled
        onClicked: button.clicked()
    }
}
