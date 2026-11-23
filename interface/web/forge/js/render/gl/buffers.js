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

    function makeLines(data) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buf: b, count: data.length / 3 };
    }

    const boxMesh = makeMesh(F.render.unitBox());
    const cylMesh = makeMesh(F.render.cylinderZ(0.066, 0.14, 18));
    const jointMesh = makeMesh(F.render.cylinderZ(0.026, 0.05, 12));
    const lineMesh = makeLines(F.render.gridLines());
    const dynamic = new WeakMap();

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

    function drawMesh(mesh, model, normal, color) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(ctx.meshLoc.aPos);
      gl.vertexAttribPointer(ctx.meshLoc.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(ctx.meshLoc.aNormal);
      gl.vertexAttribPointer(ctx.meshLoc.aNormal, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix4fv(ctx.meshLoc.uModel, false, model);
      gl.uniformMatrix3fv(ctx.meshLoc.uNormal, false, normal);
      gl.uniform3fv(ctx.meshLoc.uColor, color);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    function drawLines(mesh, vp, color) {
      gl.useProgram(ctx.lineProg);
      gl.uniformMatrix4fv(ctx.lineLoc.uVP, false, vp);
      gl.uniform3fv(ctx.lineLoc.uColor, color);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(ctx.lineLoc.aPos);
      gl.vertexAttribPointer(ctx.lineLoc.aPos, 3, gl.FLOAT, false, 12, 0);
      gl.drawArrays(gl.LINES, 0, mesh.count);
    }

    function drawMeshData(dataMesh, model, normal, color) {
      const mesh = meshFor(dataMesh);
      if (!mesh) return;
      drawMesh(mesh, model, normal, color);
    }

    return {
      boxMesh: boxMesh,
      cylMesh: cylMesh,
      jointMesh: jointMesh,
      lineMesh: lineMesh,
      meshFor: meshFor,
      drawMesh: drawMesh,
      drawMeshData: drawMeshData,
      drawLines: drawLines
    };
  }

  F.render.createBuffers = createBuffers;
})(window.AEVUM.FORGE);
