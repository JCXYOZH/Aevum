/* DOM and file helpers. No business logic, no rendering decisions. */
(function (F) {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return name;
  }

  function readFile(file, callback) {
    const reader = new FileReader();
    reader.onload = function () {
      callback(null, reader.result);
    };
    reader.onerror = function () {
      callback(reader.error || new Error("FileReader failed"));
    };
    reader.readAsText(file);
  }

  F.dom = { $: $, download: download, readFile: readFile };
})(window.AEVUM.FORGE);
