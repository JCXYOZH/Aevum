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
    const lineMesh = makeLines(F.render.gridLines());

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

    return {
      boxMesh: boxMesh,
      cylMesh: cylMesh,
      lineMesh: lineMesh,
      drawMesh: drawMesh,
      drawLines: drawLines
    };
  }

  F.render.createBuffers = createBuffers;
})(window.AEVUM.FORGE);
