/**
 * Aevum 渲染引擎 - PMX 模型解析
 *
 * 顺序解析 PMX 2.0 / 2.1 二进制：模型信息、顶点、索引、纹理、材质、骨骼。
 * 索引和骨骼宽度按文件头声明读取，兼容 1/2/4 字节索引。
 *
 * 当前批次渲染只需要网格与骨骼，因此默认在骨骼段结束后返回；
 * Morph / 刚体 / 关节解析在后续批次接入。
 *
 * @module Aevum/formats/pmx
 */
'use strict';

const PMXParser = (function () {

  class PMXParser {
    constructor() {
      this.dataView = null;
      this.offset = 0;
      this.encoding = 'utf-16le';
      this.additionalVec4 = 0;
      this.vertexIndexSize = 2;
      this.textureIndexSize = 1;
      this.materialIndexSize = 1;
      this.boneIndexSize = 2;
      this.morphIndexSize = 1;
      this.rigidBodyIndexSize = 2;
      this.softBodyIndexSize = 4;
      this.vertexCount = 0;
      this.indexCount = 0;
      this.textureCount = 0;
      this.materialCount = 0;
      this.boneCount = 0;
      this.morphCount = 0;
      this.frameCount = 0;
      this.rigidBodyCount = 0;
      this.jointCount = 0;
      this.softBodyCount = 0;
      this.model = null;
    }

    parse(buffer, options = {}) {
      const stopAfterBones = options.stopAfterBones !== false;
      this.dataView = new DataView(buffer);
      this.offset = 0;
      this.model = {
        format: 'pmx',
        version: 0,
        modelName: '',
        modelNameEn: '',
        comment: '',
        commentEn: '',
        vertexCount: 0,
        indexCount: 0,
        textureCount: 0,
        materialCount: 0,
        boneCount: 0,
        morphCount: 0,
        frameCount: 0,
        rigidBodyCount: 0,
        jointCount: 0,
        softBodyCount: 0,
        vertices: [],
        indices: [],
        textures: [],
        materials: [],
        bones: [],
        morphs: [],
        frames: [],
        rigidBodies: [],
        joints: [],
        softBodies: [],
        displayNames: [],
        boneExpressions: [],
        textExpressions: [],
        extendedData: null
      };
      this._parseHeader();
      this._parseModelInfo();
      this._parseVertices();
      this._parseIndices();
      this._parseTextures();
      this._parseMaterials();
      this._parseBones();
      if (stopAfterBones) {
        this._buildVertexData();
        return this.model;
      }
      this._parseMorphs();
      if (options.stopAfterMorphs) {
        this._buildVertexData();
        return this.model;
      }
      this._parseFrames();
      this._parseRigidBodies();
      this._parseJoints();
      if (this.model.version >= 2.1) {
        this._parseSoftBodies();
      }
      this._buildVertexData();
      return this.model;
    }

    _parseHeader() {
      const magic = this._readString(4);
      if (magic !== 'PMX ') {
        throw new Error(`Invalid PMX magic: ${magic}`);
      }
      this.model.version = this._readFloat32();
      const globalsCount = this._readUint8();
      const encodingByte = this._readUint8();
      this.encoding = encodingByte === 0 ? 'utf-16le' : 'utf-8';
      this.additionalVec4 = this._readUint8();
      this.vertexIndexSize = this._readUint8();
      this.textureIndexSize = this._readUint8();
      this.materialIndexSize = this._readUint8();
      this.boneIndexSize = this._readUint8();
      this.morphIndexSize = this._readUint8();
      this.rigidBodyIndexSize = this._readUint8();
      this.softBodyIndexSize = this.rigidBodyIndexSize;

      // 少数文件会在 globals 里追加扩展字节；跳过剩余部分。
      const extraGlobals = Math.max(0, globalsCount - 8);
      for (let i = 0; i < extraGlobals; i++) this._readUint8();
    }

    _parseModelInfo() {
      this.model.modelName = this._readText();
      this.model.modelNameEn = this._readText();
      this.model.comment = this._readText();
      this.model.commentEn = this._readText();
    }

    _parseVertices() {
      this.vertexCount = this._readInt32();
      this.model.vertexCount = this.vertexCount;
      this.model.vertices = [];
      for (let i = 0; i < this.vertexCount; i++) {
        const vertex = {
          position: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          normal: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          uv: [this._readFloat32(), this._readFloat32()],
          additionalVec4: []
        };
        for (let j = 0; j < this.additionalVec4; j++) {
          vertex.additionalVec4.push([this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()]);
        }
        const weightType = this._readUint8();
        vertex.weightType = weightType;
        switch (weightType) {
          case 0:
            vertex.boneIndices = [this._readIndex(this.boneIndexSize)];
            vertex.boneWeights = [1];
            break;
          case 1:
            vertex.boneIndices = [this._readIndex(this.boneIndexSize), this._readIndex(this.boneIndexSize)];
            vertex.boneWeights = [this._readFloat32(), 0];
            vertex.boneWeights[1] = 1 - vertex.boneWeights[0];
            break;
          case 2:
            vertex.boneIndices = [
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize)
            ];
            vertex.boneWeights = [
              this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()
            ];
            break;
          case 3:
            // SDEF: 2 个骨骼索引 + 1 个权重 + C/R0/R1。
            vertex.boneIndices = [this._readIndex(this.boneIndexSize), this._readIndex(this.boneIndexSize)];
            vertex.boneWeights = [this._readFloat32(), 0];
            vertex.boneWeights[1] = 1 - vertex.boneWeights[0];
            vertex.sdef = {
              c: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
              r0: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
              r1: [this._readFloat32(), this._readFloat32(), this._readFloat32()]
            };
            break;
          case 4:
            // QDEF: 4 个骨骼索引 + 4 个权重。
            vertex.boneIndices = [
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize),
              this._readIndex(this.boneIndexSize)
            ];
            vertex.boneWeights = [
              this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()
            ];
            break;
        }
        vertex.edgeScale = this._readFloat32();
        this.model.vertices.push(vertex);
      }
    }

    _parseIndices() {
      this.indexCount = this._readInt32();
      this.model.indexCount = this.indexCount;
      this.model.indices = [];
      for (let i = 0; i < this.indexCount; i++) {
        this.model.indices.push(this._readVertexIndex(this.vertexIndexSize));
      }
    }

    _parseTextures() {
      this.textureCount = this._readInt32();
      this.model.textureCount = this.textureCount;
      this.model.textures = [];
      for (let i = 0; i < this.textureCount; i++) {
        this.model.textures.push({ path: this._readText() });
      }
    }

    _parseMaterials() {
      this.materialCount = this._readInt32();
      this.model.materialCount = this.materialCount;
      this.model.materials = [];
      for (let i = 0; i < this.materialCount; i++) {
        const name = this._readText();
        const nameEn = this._readText();
        const diffuse = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
        const specular = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
        const specularPower = this._readFloat32();
        const ambient = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
        const flags = this._readUint8();
        const edgeColor = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
        const edgeSize = this._readFloat32();
        const textureIndex = this._readIndex(this.textureIndexSize);
        const sphereTextureIndex = this._readIndex(this.textureIndexSize);
        const sphereMode = this._readUint8();
        const sharedToon = this._readUint8() === 1;
        const toonTextureIndex = sharedToon ? this._readInt8() : this._readIndex(this.textureIndexSize);
        const comment = this._readText();
        const surfaceCount = this._readInt32();

        this.model.materials.push({
          name,
          nameEn,
          diffuse,
          specular,
          specularPower,
          ambient,
          flags,
          edgeColor,
          edgeSize,
          textureIndex,
          sphereTextureIndex,
          sphereMode,
          sharedToon,
          toonTextureIndex,
          comment,
          surfaceCount
        });
      }
    }

    _parseBones() {
      this.boneCount = this._readInt32();
      this.model.boneCount = this.boneCount;
      this.model.bones = [];
      for (let i = 0; i < this.boneCount; i++) {
        const bone = {
          name: this._readText(),
          nameEn: this._readText(),
          position: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          parentIndex: this._readIndex(this.boneIndexSize),
          transformOrder: this._readInt32(),
          flags: this._readUint16(),
          tailPosition: [0, 0, 0],
          tailIndex: -1,
          inverseKinematics: null,
          localTransform: null
        };
        if (bone.flags & 0x0001) {
          bone.tailIndex = this._readIndex(this.boneIndexSize);
        } else {
          bone.tailPosition = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
        }
        if (bone.flags & 0x0300) {
          bone.inheritParentIndex = this._readIndex(this.boneIndexSize);
          bone.inheritWeight = this._readFloat32();
        }
        if (bone.flags & 0x0400) {
          bone.fixedAxis = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
        }
        if (bone.flags & 0x0800) {
          bone.localAxisX = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
          bone.localAxisZ = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
        }
        if (bone.flags & 0x2000) {
          bone.key = this._readInt32();
        }
        if (bone.flags & 0x0020) {
          bone.inverseKinematics = {
            targetIndex: this._readIndex(this.boneIndexSize),
            loopCount: this._readInt32(),
            rotationLimit: this._readFloat32(),
            links: []
          };
          const linkCount = this._readInt32();
          for (let j = 0; j < linkCount; j++) {
            const link = {
              boneIndex: this._readIndex(this.boneIndexSize),
              hasLimit: this._readUint8() === 1,
              minAngle: [0, 0, 0],
              maxAngle: [0, 0, 0]
            };
            if (link.hasLimit) {
              link.minAngle = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              link.maxAngle = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
            }
            bone.inverseKinematics.links.push(link);
          }
        }
        this.model.bones.push(bone);
      }
    }

    _parseMorphs() {
      this.morphCount = this._readInt32();
      this.model.morphCount = this.morphCount;
      this.model.morphs = [];
      for (let i = 0; i < this.morphCount; i++) {
        const morph = {
          name: this._readText(),
          nameEn: this._readText(),
          controlPanel: this._readUint8(),
          type: this._readUint8(),
          elements: []
        };
        const elementCount = this._readInt32();
        for (let j = 0; j < elementCount; j++) {
          const element = {};
          switch (morph.type) {
            case 0: // 组合变形：引用另一个 morph
            case 9: // 翻转变形（PMX 2.1），数据结构与组合变形相同
              element.morphIndex = this._readIndex(this.morphIndexSize);
              element.morphWeight = this._readFloat32();
              break;
            case 1: // 顶点变形
              element.vertexIndex = this._readIndex(this.vertexIndexSize);
              element.position = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              break;
            case 2: // 骨骼变形
              element.boneIndex = this._readIndex(this.boneIndexSize);
              element.translation = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.rotation = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              break;
            case 3: // UV
            case 4: // UV1
            case 5: // UV2
            case 6: // UV3
            case 7: // UV4
              element.uvIndex = morph.type - 3;
              element.vertexIndex = this._readIndex(this.vertexIndexSize);
              element.uv = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              break;
            case 8: // 材质变形：材质索引 + 混合方式 + 7 组材质参数
              element.materialIndex = this._readIndex(this.materialIndexSize);
              element.addition = this._readUint8() === 1;
              element.diffuse = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.specular = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.ambient = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.edgeColor = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.edgeSize = this._readFloat32();
              element.texture = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.spTexture = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.toonTexture = [this._readFloat32(), this._readFloat32(), this._readFloat32(), this._readFloat32()];
              break;
            case 10: // 刚体冲量变形
              element.rigidBodyIndex = this._readIndex(this.rigidBodyIndexSize);
              element.local = this._readUint8() === 1;
              element.localVelocity = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              element.localTorque = [this._readFloat32(), this._readFloat32(), this._readFloat32()];
              break;
            default:
              throw new Error('未知 PMX morph 类型: ' + morph.type + '，索引 ' + i);
          }
          morph.elements.push(element);
        }
        this.model.morphs.push(morph);
      }
    }

    _parseFrames() {
      this.frameCount = this._readInt32();
      this.model.frameCount = this.frameCount;
      this.model.frames = [];
      for (let i = 0; i < this.frameCount; i++) {
        const frame = {
          name: this._readText(),
          nameEn: this._readText(),
          special: this._readUint8() === 1,
          elements: []
        };
        const elementCount = this._readInt32();
        for (let j = 0; j < elementCount; j++) {
          const elementType = this._readUint8();
          frame.elements.push({
            targetIndex: this._readInt32(),
            isBone: elementType === 0
          });
        }
        this.model.frames.push(frame);
      }
    }

    _parseRigidBodies() {
      this.rigidBodyCount = this._readInt32();
      this.model.rigidBodyCount = this.rigidBodyCount;
      this.model.rigidBodies = [];
      for (let i = 0; i < this.rigidBodyCount; i++) {
        const rigidBody = {
          name: this._readText(),
          nameEn: this._readText(),
          boneIndex: this._readInt32(),
          groupIndex: this._readUint8(),
          groupTarget: this._readUint16(),
          shapeType: this._readUint8(),
          shapeSize: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          shapePosition: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          shapeRotation: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          mass: this._readFloat32(),
          positionDamping: this._readFloat32(),
          rotationDamping: this._readFloat32(),
          restitution: this._readFloat32(),
          friction: this._readFloat32(),
          mode: this._readUint8()
        };
        this.model.rigidBodies.push(rigidBody);
      }
    }

    _parseJoints() {
      this.jointCount = this._readInt32();
      this.model.jointCount = this.jointCount;
      this.model.joints = [];
      for (let i = 0; i < this.jointCount; i++) {
        const joint = {
          name: this._readText(),
          nameEn: this._readText(),
          type: this._readUint8(),
          rigidBodyA: this._readInt32(),
          rigidBodyB: this._readInt32(),
          position: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          rotation: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          positionLowerLimit: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          positionUpperLimit: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          rotationLowerLimit: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          rotationUpperLimit: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          springPosition: [this._readFloat32(), this._readFloat32(), this._readFloat32()],
          springRotation: [this._readFloat32(), this._readFloat32(), this._readFloat32()]
        };
        this.model.joints.push(joint);
      }
    }

    _parseSoftBodies() {
      this.softBodyCount = this._readInt32();
      this.model.softBodyCount = this.softBodyCount;
      this.model.softBodies = [];
      for (let i = 0; i < this.softBodyCount; i++) {
        const softBody = {
          name: this._readText(),
          nameEn: this._readText(),
          shapeType: this._readUint8(),
          materialIndex: this._readInt32(),
          groupIndex: this._readUint8(),
          groupTarget: this._readUint16(),
          mode: this._readUint8(),
          bDistance: this._readInt32(),
          clusterCount: this._readInt32(),
          totalMass: this._readFloat32(),
          collisionMargin: this._readFloat32(),
          aeroModel: this._readUint8(),
          config: {
            vcf: this._readFloat32(),
            dp: this._readFloat32(),
            dg: this._readFloat32(),
            lf: this._readFloat32(),
            pr: this._readFloat32(),
            vc: this._readFloat32(),
            df: this._readFloat32(),
            mt: this._readFloat32(),
            chr: this._readFloat32(),
            vhr: this._readFloat32(),
            srhrClamp: this._readFloat32(),
            skhrClamp: this._readFloat32(),
            sshrClamp: this._readFloat32(),
            srSplt: this._readFloat32(),
            skSplt: this._readFloat32(),
            srShrs: this._readFloat32(),
            skShrs: this._readFloat32(),
            algorithm: this._readInt32()
          },
          clusters: [],
          pins: [],
          anchors: []
        };
        const clusterCount = this._readInt32();
        for (let j = 0; j < clusterCount; j++) {
          softBody.clusters.push({
            vertexIndex: this._readInt32(),
            deformation: this._readFloat32(),
            shortLinks: this._readUint8() === 1
          });
        }
        const pinCount = this._readInt32();
        for (let j = 0; j < pinCount; j++) {
          softBody.pins.push({
            vertexIndex: this._readInt32(),
            type: this._readUint8(),
            rigidBodyIndex: this._readInt32(),
            vertexNear: this._readInt32()
          });
        }
        this.model.softBodies.push(softBody);
      }
    }

    _buildVertexData() {
      const stride = 3 + 3 + 2 + this.additionalVec4 * 4 + 4 + 4 + 1;
      const vertexData = new Float32Array(this.vertexCount * stride);
      const boneIndices = new Int32Array(this.vertexCount * 4);
      const boneWeights = new Float32Array(this.vertexCount * 4);
      for (let i = 0; i < this.vertexCount; i++) {
        const v = this.model.vertices[i];
        const base = i * stride;
        vertexData[base] = v.position[0];
        vertexData[base + 1] = v.position[1];
        vertexData[base + 2] = v.position[2];
        vertexData[base + 3] = v.normal[0];
        vertexData[base + 4] = v.normal[1];
        vertexData[base + 5] = v.normal[2];
        vertexData[base + 6] = v.uv[0];
        vertexData[base + 7] = v.uv[1];
        let offset = 8;
        for (let j = 0; j < this.additionalVec4; j++) {
          vertexData[base + offset] = v.additionalVec4[j][0];
          vertexData[base + offset + 1] = v.additionalVec4[j][1];
          vertexData[base + offset + 2] = v.additionalVec4[j][2];
          vertexData[base + offset + 3] = v.additionalVec4[j][3];
          offset += 4;
        }
        for (let j = 0; j < 4; j++) {
          boneIndices[i * 4 + j] = v.boneIndices[j] ?? -1;
          boneWeights[i * 4 + j] = v.boneWeights[j] ?? 0;
        }
      }
      this.model.vertexData = vertexData;
      this.model.boneIndices = boneIndices;
      this.model.boneWeights = boneWeights;
      this.model.vertexStride = stride;
      this.model.additionalVec4 = this.additionalVec4;
    }

    _readString(length) {
      let result = '';
      for (let i = 0; i < length; i++) {
        result += String.fromCharCode(this._readUint8());
      }
      return result;
    }

    _readText() {
      const length = this._readInt32();
      if (length <= 0) return '';
      const bytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, length);
      this.offset += length;
      if (this.encoding === 'utf-16le') {
        let result = '';
        for (let i = 0; i < length; i += 2) {
          result += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
        }
        return result;
      } else {
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(bytes);
      }
    }

    _readUint8() {
      const value = this.dataView.getUint8(this.offset);
      this.offset += 1;
      return value;
    }

    _readInt8() {
      const value = this.dataView.getInt8(this.offset);
      this.offset += 1;
      return value;
    }

    _readIndex(size) {
      if (size === 1) return this._readInt8();
      if (size === 2) {
        const value = this.dataView.getInt16(this.offset, true);
        this.offset += 2;
        return value;
      }
      return this._readInt32();
    }

    // PMX 顶点索引是无符号数；顶点数超过 32767 时必须按 uint 读取。
    _readVertexIndex(size) {
      if (size === 1) {
        const value = this.dataView.getUint8(this.offset);
        this.offset += 1;
        return value;
      }
      if (size === 2) {
        const value = this.dataView.getUint16(this.offset, true);
        this.offset += 2;
        return value;
      }
      const value = this.dataView.getUint32(this.offset, true);
      this.offset += 4;
      return value;
    }

    _readInt32() {
      const value = this.dataView.getInt32(this.offset, true);
      this.offset += 4;
      return value;
    }

    _readFloat32() {
      const value = this.dataView.getFloat32(this.offset, true);
      this.offset += 4;
      return value;
    }

    _readUint16() {
      const value = this.dataView.getUint16(this.offset, true);
      this.offset += 2;
      return value;
    }

    getModel() { return this.model; }
    getVertexCount() { return this.vertexCount; }
    getIndexCount() { return this.indexCount; }
    getBoneCount() { return this.boneCount; }
    getMaterialCount() { return this.materialCount; }
    getMorphCount() { return this.morphCount; }
    getTextureCount() { return this.textureCount; }
    getRigidBodyCount() { return this.rigidBodyCount; }
    getJointCount() { return this.jointCount; }
    getVersion() { return this.model?.version || 0; }
    dispose() { this.dataView = null; this.model = null; }
  }

  return { PMXParser };
})();

if (typeof window !== 'undefined') window.PMXParser = PMXParser.PMXParser;
if (typeof globalThis !== 'undefined') globalThis.PMXParser = PMXParser.PMXParser;

function parsePMX(buffer, options) {
  return new PMXParser.PMXParser().parse(buffer, options);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PMXParser: PMXParser.PMXParser, parsePMX };
}

if (typeof globalThis !== 'undefined') {
  globalThis.AEVUM = globalThis.AEVUM || {};
  globalThis.AEVUM.formats = globalThis.AEVUM.formats || {};
  globalThis.AEVUM.formats.PMXParser = PMXParser.PMXParser;
  globalThis.AEVUM.formats.parsePMX = parsePMX;
}
