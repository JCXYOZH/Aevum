/* GPU buffers + draw calls. Only this file binds mesh/line attributes. */
(function (F) {
  "use strict";

  function createBuffers(ctx) {
    const gl = ctx.gl;

    function makeMesh(data) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buf: b, count: data.length / 6 };
    }

    function makeRaw(data, itemSize) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buf: b, count: data.length / itemSize, itemSize: itemSize || 3 };
    }

    const boxMesh = makeMesh(F.render.superBox(28, 14, 0.32));
    const plainBox = makeMesh(F.render.unitBox());
    const cylMesh = makeMesh(F.render.cylinderZ(0.5, 1, 24));
    const jointMesh = makeMesh(F.render.cylinderZ(0.5, 1, 20));
    const ringMesh = makeMesh(F.render.torusZ(1, 0.13, 40, 8));
    const axisMesh = makeMesh(F.render.cylinderZ(0.5, 1, 8));
    const gridMesh = makeRaw(F.render.gridPlane(80, 0), 6);
    const shadowMesh = makeMesh(F.render.disk(56));
    const bgMesh = makeRaw(F.render.bgQuad(), 2);
    const dynamic = new WeakMap();
    const lineBuf = gl.createBuffer();
    const eye = [0, 0, 0];

    function meshFor(dataMesh) {
      if (!dataMesh || !Array.isArray(dataMesh.positions) || dataMesh.positions.length < 9) return null;
      let cached = dynamic.get(dataMesh);
      if (cached) return cached;
      const pos = dataMesh.positions;
      const nor = Array.isArray(dataMesh.normals) && dataMesh.normals.length >= pos.length
        ? dataMesh.normals
        : new Array(pos.length).fill(0);
      const data = new Array(pos.length * 2);
      for (let i = 0, p = 0; i < pos.length; i += 3, p += 6) {
        data[p] = pos[i];
        data[p + 1] = pos[i + 1];
        data[p + 2] = pos[i + 2];
        data[p + 3] = nor[i];
        data[p + 4] = nor[i + 1];
        data[p + 5] = nor[i + 2];
      }
      cached = makeMesh(data);
      dynamic.set(dataMesh, cached);
      return cached;
    }

    function setEye(v) {
      eye[0] = v[0]; eye[1] = v[1]; eye[2] = v[2];
    }

    function drawMeshOpts(mesh, model, normal, color, alpha, flat) {
      if (!mesh) return;
      gl.useProgram(ctx.meshProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(ctx.meshLoc.aPos);
      gl.vertexAttribPointer(ctx.meshLoc.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(ctx.meshLoc.aNormal);
      gl.vertexAttribPointer(ctx.meshLoc.aNormal, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix4fv(ctx.meshLoc.uModel, false, model);
      gl.uniformMatrix3fv(ctx.meshLoc.uNormal, false, normal);
      gl.uniform3fv(ctx.meshLoc.uColor, color);
      gl.uniform3fv(ctx.meshLoc.uEye, eye);
      gl.uniform1f(ctx.meshLoc.uAlpha, alpha === undefined ? 1 : alpha);
      gl.uniform1f(ctx.meshLoc.uFlat, flat ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    function drawMesh(mesh, model, normal, color) {
      drawMeshOpts(mesh, model, normal, color, 1, 0);
    }

    function drawMeshData(dataMesh, model, normal, color) {
      const mesh = meshFor(dataMesh);
      if (!mesh) return;
      drawMeshOpts(mesh, model, normal, color, 1, 0);
    }

    function drawLines(mesh, vp, color, alpha) {
      gl.useProgram(ctx.lineProg);
      gl.uniformMatrix4fv(ctx.lineLoc.uVP, false, vp);
      gl.uniform3fv(ctx.lineLoc.uColor, color);
      gl.uniform1f(ctx.lineLoc.uAlpha, alpha === undefined ? 0.6 : alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(ctx.lineLoc.aPos);
      gl.vertexAttribPointer(ctx.lineLoc.aPos, 3, gl.FLOAT, false, 12, 0);
      gl.drawArrays(gl.LINES, 0, mesh.count);
    }

    function drawPolyline(points, vp, color, alpha) {
      if (!points || points.length < 6) return;
      gl.useProgram(ctx.lineProg);
      gl.uniformMatrix4fv(ctx.lineLoc.uVP, false, vp);
      gl.uniform3fv(ctx.lineLoc.uColor, color);
      gl.uniform1f(ctx.lineLoc.uAlpha, alpha === undefined ? 0.8 : alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(ctx.lineLoc.aPos);
      gl.vertexAttribPointer(ctx.lineLoc.aPos, 3, gl.FLOAT, false, 12, 0);
      gl.drawArrays(gl.LINE_STRIP, 0, points.length / 3);
    }

    function drawSegments(points, vp, color, alpha) {
      if (!points || points.length < 6) return;
      gl.useProgram(ctx.lineProg);
      gl.uniformMatrix4fv(ctx.lineLoc.uVP, false, vp);
      gl.uniform3fv(ctx.lineLoc.uColor, color);
      gl.uniform1f(ctx.lineLoc.uAlpha, alpha === undefined ? 0.8 : alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(ctx.lineLoc.aPos);
      gl.vertexAttribPointer(ctx.lineLoc.aPos, 3, gl.FLOAT, false, 12, 0);
      gl.drawArrays(gl.LINES, 0, points.length / 3);
    }

    function drawBg(aspect) {
      gl.useProgram(ctx.bgProg);
      gl.uniform1f(ctx.bgLoc.uAspect, aspect);
      gl.bindBuffer(gl.ARRAY_BUFFER, bgMesh.buf);
      gl.enableVertexAttribArray(ctx.bgLoc.aPos);
      gl.vertexAttribPointer(ctx.bgLoc.aPos, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawGrid(vp) {
      gl.useProgram(ctx.gridProg);
      gl.uniformMatrix4fv(ctx.gridLoc.uVP, false, vp);
      gl.uniform3fv(ctx.gridLoc.uEye, eye);
      gl.bindBuffer(gl.ARRAY_BUFFER, gridMesh.buf);
      gl.enableVertexAttribArray(ctx.gridLoc.aPos);
      gl.vertexAttribPointer(ctx.gridLoc.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawShadow(model, vp, alpha) {
      gl.useProgram(ctx.shadowProg);
      gl.uniformMatrix4fv(ctx.shadowLoc.uVP, false, vp);
      gl.uniformMatrix4fv(ctx.shadowLoc.uModel, false, model);
      gl.uniform1f(ctx.shadowLoc.uAlpha, alpha === undefined ? 0.35 : alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowMesh.buf);
      gl.enableVertexAttribArray(ctx.shadowLoc.aPos);
      gl.vertexAttribPointer(ctx.shadowLoc.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.drawArrays(gl.TRIANGLES, 0, shadowMesh.count);
    }

    return {
      boxMesh: boxMesh,
      plainBox: plainBox,
      cylMesh: cylMesh,
      jointMesh: jointMesh,
      ringMesh: ringMesh,
      axisMesh: axisMesh,
      gridMesh: gridMesh,
      shadowMesh: shadowMesh,
      bgMesh: bgMesh,
      meshFor: meshFor,
      setEye: setEye,
      drawMesh: drawMesh,
      drawMeshOpts: drawMeshOpts,
      drawMeshData: drawMeshData,
      drawLines: drawLines,
      drawPolyline: drawPolyline,
      drawSegments: drawSegments,
      drawBg: drawBg,
      drawGrid: drawGrid,
      drawShadow: drawShadow
    };
  }

  F.render.createBuffers = createBuffers;
})(window.AEVUM.FORGE);
