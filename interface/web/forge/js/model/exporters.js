/* Exporters: BodyDocument → JSON / MuJoCo XML / virtual-bus manifest. */
(function (F) {
  "use strict";

  function n(v) {
    return (Math.round(v * 10000) / 10000).toString();
  }

  function rgba(c) {
    return c.map(function (x) { return n(x); }).join(" ") + " 1";
  }

  function buildXml(doc) {
    const b = doc.base;
    let x = "<mujoco model=\"aevum_arm3\">\n  <compiler angle=\"degree\"/>\n  <option timestep=\"" + n(doc.control.dt) + "\"/>\n  <worldbody>\n";
    x += "    <body name=\"base\" pos=\"0 0 0\">\n";
    x += "      <geom name=\"base_geom\" type=\"box\" size=\"" + n(b.w / 2) + " " + n(b.h / 2) + " " + n(b.d / 2) + "\" pos=\"0 " + n(b.h / 2) + " 0\" rgba=\"" + rgba(b.color) + "\"/>\n";
    let parentIndent = "      ";
    for (let i = 0; i < doc.segments.length; i++) {
      const s = doc.segments[i];
      const pos = i === 0 ? "0 " + n(b.h) + " 0" : n(doc.segments[i - 1].length) + " 0 0";
      x += parentIndent + "<body name=\"" + s.id.toLowerCase() + "\" pos=\"" + pos + "\">\n";
      const j = parentIndent + "  ";
      x += j + "<joint name=\"" + s.id.toLowerCase() + "_joint\" type=\"hinge\" axis=\"0 0 1\" range=\"" + n(s.min) + " " + n(s.max) + "\" armature=\"" + n(s.inertia) + "\" damping=\"" + n(s.damping) + "\"/>\n";
      x += j + "<geom name=\"" + s.id.toLowerCase() + "_geom\" type=\"box\" size=\"" + n(s.length / 2) + " " + n(s.width / 2) + " " + n(s.depth / 2) + "\" pos=\"" + n(s.length / 2) + " 0 0\" rgba=\"" + rgba(s.color) + "\"/>\n";
      parentIndent = j;
    }
    for (let i = doc.segments.length - 1; i >= 0; i--) {
      x += "      ".repeat(i + 1) + "</body>\n";
    }
    x += "    </body>\n  </worldbody>\n  <actuator>\n";
    doc.segments.forEach(function (s) {
      x += "    <motor name=\"m_" + s.id.toLowerCase() + "\" joint=\"" + s.id.toLowerCase() + "_joint\" ctrlrange=\"-1 1\" gear=\"" + n(s.torque) + "\"/>\n";
    });
    x += "  </actuator>\n</mujoco>\n";
    return x;
  }

  function buildManifest(doc, bridge) {
    return {
      format: "aevum.virtual_bus/0",
      body: doc,
      transport: { kind: "websocket", url: bridge.url, loop_hz: doc.control.loop_hz },
      packet: { command: "seq,target[3],q[3]", state: "seq,q[3],target[3],error[3]" },
      note: "Temporary experimental seam. The kernel runs outside this page; this manifest is not a formal robot API."
    };
  }

  function exportJson(doc, notify) {
    const name = doc.name.replace(/\s+/g, "_").toLowerCase() + ".json";
    F.dom.download(name, JSON.stringify(doc, null, 2), "application/json");
    if (notify) notify("已导出 " + name);
  }

  function exportXml(doc, notify) {
    const name = "aevum_arm3.xml";
    F.dom.download(name, buildXml(doc), "application/xml");
    if (notify) notify("已导出 " + name);
  }

  function exportManifest(doc, bridge, notify) {
    const name = "aevum_arm3_bus.json";
    F.dom.download(name, JSON.stringify(buildManifest(doc, bridge), null, 2), "application/json");
    if (notify) notify("已导出 " + name);
  }

  F.model.buildXml = buildXml;
  F.model.buildManifest = buildManifest;
  F.model.exportJson = exportJson;
  F.model.exportXml = exportXml;
  F.model.exportManifest = exportManifest;
})(window.AEVUM.FORGE);
