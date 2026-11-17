import QtQuick

Rectangle {
    id: foot
    property var theme
    property bool online: false
    property string detail: ""

    height: 28
    color: theme ? theme.ink : "#f6f0e3"
    border.width: 1
    border.color: theme ? theme.line : "#d8cbb6"

    Text {
        anchors.left: parent.left
        anchors.leftMargin: 16
        anchors.verticalCenter: parent.verticalCenter
        text: "AEVUM / MEMORIA · QML SHELL"
        color: theme ? theme.dim : "#8a8070"
        font.family: theme ? theme.mono : "Cascadia Mono"
        font.pixelSize: 9
        font.letterSpacing: 0.5
    }

    Text {
        id: center
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        text: foot.online ? "监控服务：已连接" : "监控服务：未连接"
        color: foot.online
            ? (theme ? theme.muted : "#5f584b")
            : (theme ? theme.red : "#b04747")
        font.family: theme ? theme.mono : "Cascadia Mono"
        font.pixelSize: 9
    }

    Text {
        anchors.right: parent.right
        anchors.rightMargin: 16
        anchors.verticalCenter: parent.verticalCenter
        text: foot.detail.length > 0 ? foot.detail : "127.0.0.1 · 原生外壳 / WebEngine 场景"
        color: theme ? theme.dim : "#8a8070"
        font.family: theme ? theme.mono : "Cascadia Mono"
        font.pixelSize: 9
    }
}
