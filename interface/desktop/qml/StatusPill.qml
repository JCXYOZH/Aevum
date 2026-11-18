import QtQuick

Rectangle {
    id: pill
    property var theme
    property string label: ""
    property bool ok: false
    property bool pending: false

    height: 28
    width: dot.width + labelText.implicitWidth + 22
    color: "transparent"
    border.width: 1
    border.color: theme ? theme.line : "#d8cbb6"
    radius: 0

    Rectangle {
        id: dot
        width: 6
        height: 6
        anchors.left: parent.left
        anchors.leftMargin: 9
        anchors.verticalCenter: parent.verticalCenter
        color: pill.ok
            ? (pill.theme ? pill.theme.teal : "#2f7c76")
            : (pill.pending ? (pill.theme ? pill.theme.amber : "#a9722d")
                            : (pill.theme ? pill.theme.red : "#b04747"))
    }

    Text {
        id: labelText
        anchors.left: dot.right
        anchors.leftMargin: 7
        anchors.verticalCenter: parent.verticalCenter
        text: pill.label
        color: pill.theme ? pill.theme.muted : "#5f584b"
        font.family: pill.theme ? pill.theme.mono : "Cascadia Mono"
        font.pixelSize: 11
        font.letterSpacing: 0.4
    }
}
