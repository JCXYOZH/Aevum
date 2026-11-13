/**
 * 模型格式扩展 - FBX解析/VRM解析/格式转换器/动画压缩/骨骼重定向
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const ModelFormatsExt = (function () {

  // ============================================================
  // FBX解析器（ASCII格式）
  // ============================================================
  class FBXParser {
    constructor() {
      this.version = 0;
      this.nodes = [];
      this.objects = new Map();
      this.connections = [];
      this.models = [];
      this.geometries = [];
      this.materials = [];
      this.textures = [];
      this.animations = [];
      this.skeletons = [];
      this.poses = [];
      this.globalSettings = null;
    }

    parse(text) {
      this.nodes = [];
      this.objects.clear();
      this.connections = [];
      this.models = [];
      this.geometries = [];
      this.materials = [];
      this.textures = [];
      this.animations = [];
      this.skeletons = [];
      this.poses = [];
      const lines = text.split('\n');
      this._parseNodes(lines, 0, 0);
      this._extractObjects();
      this._extractConnections();
      this._buildHierarchy();
      return this._buildModel();
    }

    _parseNodes(lines, startIndex, depth) {
      const nodes = [];
      let i = startIndex;
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';')) { i++; continue; }
        const currentDepth = line.search(/\S/);
        if (currentDepth < depth) break;
        if (currentDepth > depth) { i++; continue; }
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) { i++; continue; }
        const name = trimmed.substring(0, colonIndex).trim();
        const rest = trimmed.substring(colonIndex + 1).trim();
        const node = { name, properties: [], children: [], value: null };
        if (rest && rest !== '{') {
          node.properties = this._parseProperties(rest);
        }
        if (rest.includes('{') || lines[i + 1]?.trim() === '{') {
          let braceLine = i;
          if (!rest.includes('{')) braceLine = i + 1;
          const childNodes = this._parseNodes(lines, braceLine + 1, depth + 4);
          node.children = childNodes.nodes;
          i = childNodes.nextIndex;
        } else {
          i++;
        }
        nodes.push(node);
      }
      return { nodes, nextIndex: i };
    }

    _parseProperties(str) {
      const properties = [];
      let current = '';
      let inString = false;
      let inArray = false;
      let arrayDepth = 0;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '"' && !inArray) {
          inString = !inString;
          current += c;
        } else if (c === '*' && !inString) {
          inArray = true;
          arrayDepth = 1;
          current += c;
        } else if (inArray) {
          current += c;
          if (c === '{') arrayDepth++;
          else if (c === '}') {
            arrayDepth--;
            if (arrayDepth === 0) inArray = false;
          }
        } else if (c === ',' && !inString) {
          properties.push(this._parsePropertyValue(current.trim()));
          current = '';
        } else {
          current += c;
        }
      }
      if (current.trim()) properties.push(this._parsePropertyValue(current.trim()));
      return properties;
    }

    _parsePropertyValue(str) {
      if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
      if (str.startsWith('*')) {
        const match = str.match(/\*(\d+)\s*\{([^}]*)\}/);
        if (match) {
          const count = parseInt(match[1]);
          const values = match[2].split(',').map(v => parseFloat(v.trim()));
          return { type: 'array', count, values };
        }
      }
      const num = parseFloat(str);
      if (!isNaN(num) && str !== '') return num;
      return str;
    }

    _extractObjects() {
      const objectsNode = this.nodes.find(n => n.name === 'Objects');
      if (!objectsNode) return;
      for (const child of objectsNode.children) {
        const id = child.properties[0];
        const name = child.properties[1] || '';
        const type = child.properties[2] || child.name;
        const obj = { id, name, type, node: child, properties: {} };
        this._extractNodeProperties(child, obj.properties);
        this.objects.set(id, obj);
        if (type === 'Model' || child.name === 'Model') this.models.push(obj);
        else if (type === 'Geometry' || child.name === 'Geometry') this.geometries.push(obj);
        else if (type === 'Material' || child.name === 'Material') this.materials.push(obj);
        else if (type === 'Texture' || child.name === 'Texture') this.textures.push(obj);
        else if (type === 'AnimationStack' || type === 'AnimationLayer' || type === 'AnimationCurveNode' || type === 'AnimationCurve') this.animations.push(obj);
        else if (type === 'PoseNode' || type === 'Pose') this.poses.push(obj);
      }
    }

    _extractNodeProperties(node, target) {
      for (const child of node.children) {
        if (child.children.length === 0 && child.properties.length > 0) {
          target[child.name] = child.properties;
        } else if (child.children.length > 0) {
          target[child.name] = {};
          this._extractNodeProperties(child, target[child.name]);
        }
      }
    }

    _extractConnections() {
      const connNode = this.nodes.find(n => n.name === 'Connections');
      if (!connNode) return;
      for (const child of connNode.children) {
        if (child.name === 'C' && child.properties.length >= 3) {
          this.connections.push({
            type: child.properties[0],
            from: child.properties[1],
            to: child.properties[2],
            property: child.properties[3] || null
          });
        }
      }
    }

    _buildHierarchy() {
      for (const model of this.models) {
        model.children = [];
        model.parent = null;
        model.geometries = [];
        model.materials = [];
      }
      for (const conn of this.connections) {
        if (conn.type === 'OO') {
          const from = this.objects.get(conn.from);
          const to = this.objects.get(conn.to);
          if (from && to) {
            if (from.type === 'Model' && to.type === 'Model') {
              from.parent = to;
              to.children.push(from);
            } else if (from.type === 'Geometry' && to.type === 'Model') {
              to.geometries.push(from);
            } else if (from.type === 'Material' && to.type === 'Model') {
              to.materials.push(from);
            }
          }
        }
      }
    }

    _buildModel() {
      const result = {
        format: 'FBX',
        version: this.version,
        nodes: [],
        geometries: [],
        materials: [],
        textures: [],
        animations: [],
        skeleton: null,
        metadata: {}
      };
      for (const geo of this.geometries) {
        result.geometries.push(this._parseGeometry(geo));
      }
      for (const mat of this.materials) {
        result.materials.push(this._parseMaterial(mat));
      }
      for (const tex of this.textures) {
        result.textures.push(this._parseTexture(tex));
      }
      result.animations = this._parseAnimations();
      result.skeleton = this._buildSkeleton();
      result.metadata = {
        modelCount: this.models.length,
        geometryCount: this.geometries.length,
        materialCount: this.materials.length,
        textureCount: this.textures.length,
        animationCount: this.animations.length
      };
      return result;
    }

    _parseGeometry(geo) {
      const result = { id: geo.id, name: geo.name, vertices: [], normals: [], uvs: [], indices: [], materials: [] };
      const verticesProp = geo.properties.Vertices;
      if (verticesProp && verticesProp[0]?.values) result.vertices = verticesProp[0].values;
      const indicesProp = geo.properties.PolygonVertexIndex;
      if (indicesProp && indicesProp[0]?.values) {
        const rawIndices = indicesProp[0].values;
        let faceStart = 0;
        for (let i = 0; i < rawIndices.length; i++) {
          let idx = rawIndices[i];
          if (idx < 0) {
            idx = -idx - 1;
            const faceSize = i - faceStart + 1;
            if (faceSize === 3) {
              result.indices.push(rawIndices[faceStart], rawIndices[faceStart+1], idx);
            } else if (faceSize === 4) {
              result.indices.push(rawIndices[faceStart], rawIndices[faceStart+1], rawIndices[faceStart+2]);
              result.indices.push(rawIndices[faceStart], rawIndices[faceStart+2], idx);
            }
            faceStart = i + 1;
          }
        }
      }
      const normalsProp = geo.properties.Normals;
      if (normalsProp && normalsProp[0]?.values) result.normals = normalsProp[0].values;
      const uvProp = geo.properties.LayerElementUV;
      if (uvProp) {
        const uvNode = typeof uvProp === 'object' ? uvProp : null;
        if (uvNode?.UV?.[0]?.values) result.uvs = uvNode.UV[0].values;
      }
      return result;
    }

    _parseMaterial(mat) {
      const result = { id: mat.id, name: mat.name, diffuse: [1, 1, 1], specular: [0, 0, 0], emissive: [0, 0, 0], shininess: 0, opacity: 1, textures: {} };
      const diffuseProp = mat.properties.Diffuse;
      if (diffuseProp && diffuseProp[0]?.values) result.diffuse = diffuseProp[0].values;
      const specularProp = mat.properties.Specular;
      if (specularProp && specularProp[0]?.values) result.specular = specularProp[0].values;
      const emissiveProp = mat.properties.Emissive;
      if (emissiveProp && emissiveProp[0]?.values) result.emissive = emissiveProp[0].values;
      const shininessProp = mat.properties.Shininess;
      if (shininessProp) result.shininess = shininessProp[0];
      const opacityProp = mat.properties.Opacity;
      if (opacityProp) result.opacity = opacityProp[0];
      return result;
    }

    _parseTexture(tex) {
      const result = { id: tex.id, name: tex.name, filename: '', relativeFilename: '', type: 'Texture' };
      const fileNameProp = tex.properties.FileName;
      if (fileNameProp) result.filename = fileNameProp[0];
      const relativeProp = tex.properties.RelativeFilename;
      if (relativeProp) result.relativeFilename = relativeProp[0];
      return result;
    }

    _parseAnimations() {
      const result = [];
      const stacks = this.animations.filter(a => a.type === 'AnimationStack');
      for (const stack of stacks) {
        const anim = { name: stack.name, duration: 0, frames: [], curves: [] };
        const layers = this.connections.filter(c => c.from === stack.id && this.objects.get(c.to)?.type === 'AnimationLayer');
        for (const layerConn of layers) {
          const layer = this.objects.get(layerConn.to);
          const curveNodes = this.connections.filter(c => c.from === layer.id && this.objects.get(c.to)?.type === 'AnimationCurveNode');
          for (const cnConn of curveNodes) {
            const curveNode = this.objects.get(cnConn.to);
            const curves = this.connections.filter(c => c.from === curveNode.id && this.objects.get(c.to)?.type === 'AnimationCurve');
            for (const curveConn of curves) {
              const curve = this.objects.get(curveConn.to);
              const timesProp = curve.properties.KeyTime;
              const valuesProp = curve.properties.KeyValueFloat;
              if (timesProp?.[0]?.values && valuesProp?.[0]?.values) {
                anim.curves.push({
                  node: curveNode.name,
                  property: curveConn.property,
                  times: timesProp[0].values,
                  values: valuesProp[0].values
                });
              }
            }
          }
        }
        result.push(anim);
      }
      return result;
    }

    _buildSkeleton() {
      const rootModels = this.models.filter(m => !m.parent);
      if (rootModels.length === 0) return null;
      const bones = [];
      const boneMap = new Map();
      const traverse = (model, parentIndex = -1) => {
        const index = bones.length;
        const bone = {
          name: model.name,
          parentIndex,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          children: []
        };
        const lclProp = model.properties.LclTranslation;
        if (lclProp?.[0]?.values) bone.position = lclProp[0].values;
        const lclRotProp = model.properties.LclRotation;
        if (lclRotProp?.[0]?.values) {
          const euler = lclRotProp[0].values;
          bone.rotation = this._eulerToQuaternion(euler[0], euler[1], euler[2]);
        }
        const lclScaleProp = model.properties.LclScaling;
        if (lclScaleProp?.[0]?.values) bone.scale = lclScaleProp[0].values;
        boneMap.set(model.id, index);
        bones.push(bone);
        for (const child of model.children) {
          const childIndex = traverse(child, index);
          bone.children.push(childIndex);
        }
        return index;
      };
      for (const root of rootModels) traverse(root);
      return { bones, boneCount: bones.length, rootIndex: 0 };
    }

    _eulerToQuaternion(x, y, z) {
      const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
      const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
      const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
      return [
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz
      ];
    }

    getModelCount() { return this.models.length; }
    getGeometryCount() { return this.geometries.length; }
    getMaterialCount() { return this.materials.length; }
    getAnimationCount() { return this.animations.length; }
    dispose() { this.nodes = []; this.objects.clear(); this.connections = []; }
  }

  // ============================================================
  // VRM解析器
  // ============================================================
  class VRMParser {
    constructor() {
      this.json = null;
      this.binaryChunks = [];
      this.gltf = null;
      this.vrmExtension = null;
      this.meta = null;
      this.humanoid = null;
      this.blendShapeMaster = null;
      this.firstPerson = null;
      this.springBone = null;
      this.lookAt = null;
      this.materialProperties = [];
    }

    parse(buffer) {
      this.json = null;
      this.binaryChunks = [];
      this.gltf = null;
      this.vrmExtension = null;
      this.meta = null;
      this.humanoid = null;
      this.blendShapeMaster = null;
      this.firstPerson = null;
      this.springBone = null;
      this.lookAt = null;
      this.materialProperties = [];
      const dataView = new DataView(buffer);
      const magic = dataView.getUint32(0, true);
      if (magic !== 0x46546C67) throw new Error('Invalid glTF binary magic');
      const version = dataView.getUint32(4, true);
      const length = dataView.getUint32(8, true);
      let offset = 12;
      while (offset < length) {
        const chunkLength = dataView.getUint32(offset, true);
        const chunkType = dataView.getUint32(offset + 4, true);
        const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);
        if (chunkType === 0x4E4F534A) {
          const decoder = new TextDecoder('utf-8');
          this.json = JSON.parse(decoder.decode(chunkData));
        } else if (chunkType === 0x004E4942) {
          this.binaryChunks.push(chunkData);
        }
        offset += 8 + chunkLength;
      }
      if (!this.json) throw new Error('No JSON chunk found');
      this.gltf = this.json;
      this.vrmExtension = this.json.extensions?.VRM;
      if (this.vrmExtension) {
        this.meta = this.vrmExtension.meta;
        this.humanoid = this.vrmExtension.humanoid;
        this.blendShapeMaster = this.vrmExtension.blendShapeMaster;
        this.firstPerson = this.vrmExtension.firstPerson;
        this.springBone = this.vrmExtension.springBone;
        this.lookAt = this.vrmExtension.lookAt;
        this.materialProperties = this.vrmExtension.materialProperties || [];
      }
      return this._buildModel();
    }

    _buildModel() {
      const result = {
        format: 'VRM',
        version: this.vrmExtension?.specVersion || '1.0',
        meta: this.meta ? { ...this.meta } : null,
        humanoid: this.humanoid ? this._parseHumanoid() : null,
        blendShapes: this.blendShapeMaster ? this._parseBlendShapes() : [],
        springBones: this.springBone ? this._parseSpringBones() : [],
        lookAt: this.lookAt ? { ...this.lookAt } : null,
        firstPerson: this.firstPerson ? { ...this.firstPerson } : null,
        materials: this._parseMaterials(),
        meshes: this._parseMeshes(),
        nodes: this.gltf.nodes || [],
        scenes: this.gltf.scenes || [],
        animations: this.gltf.animations || [],
        textures: this.gltf.textures || [],
        images: this.gltf.images || [],
        asset: this.gltf.asset || {}
      };
      return result;
    }

    _parseHumanoid() {
      const bones = {};
      for (const bone of this.humanoid.humanBones) {
        bones[bone.bone] = {
          node: bone.node,
          useDefaultValues: bone.useDefaultValues,
          min: bone.min,
          max: bone.max,
          center: bone.center,
          axisLength: bone.axisLength
        };
      }
      return {
        armStretch: this.humanoid.armStretch,
        legStretch: this.humanoid.legStretch,
        upperArmTwist: this.humanoid.upperArmTwist,
        lowerArmTwist: this.humanoid.lowerArmTwist,
        upperLegTwist: this.humanoid.upperLegTwist,
        lowerLegTwist: this.humanoid.lowerLegTwist,
        feetSpacing: this.humanoid.feetSpacing,
        hasTranslationDoF: this.humanoid.hasTranslationDoF,
        bones
      };
    }

    _parseBlendShapes() {
      const groups = [];
      for (const group of this.blendShapeMaster.blendShapeGroups) {
        groups.push({
          name: group.name,
          presetName: group.presetName,
          binds: group.binds || [],
          materialValues: group.materialValues || [],
          isBinary: group.isBinary,
          ignoreBlink: group.ignoreBlink,
          ignoreLookAt: group.ignoreLookAt,
          ignoreMouth: group.ignoreMouth
        });
      }
      return groups;
    }

    _parseSpringBones() {
      const groups = [];
      for (const group of this.springBone.springBoneGroups) {
        groups.push({
          comment: group.comment,
          stiffiness: group.stiffiness,
          gravityPower: group.gravityPower,
          gravityDir: group.gravityDir,
          dragForce: group.dragForce,
          center: group.center,
          hitRadius: group.hitRadius,
          bones: group.bones || [],
          colliderGroups: group.colliderGroups || []
        });
      }
      const colliders = [];
      for (const group of this.springBone.colliderGroups || []) {
        colliders.push({
          node: group.node,
          colliders: group.colliders || []
        });
      }
      return { groups, colliders };
    }

    _parseMaterials() {
      const materials = [];
      for (let i = 0; i < (this.gltf.materials || []).length; i++) {
        const mat = this.gltf.materials[i];
        const vrmProp = this.materialProperties[i];
        materials.push({
          name: mat.name,
          pbrMetallicRoughness: mat.pbrMetallicRoughness,
          normalTexture: mat.normalTexture,
          occlusionTexture: mat.occlusionTexture,
          emissiveTexture: mat.emissiveTexture,
          emissiveFactor: mat.emissiveFactor,
          alphaMode: mat.alphaMode,
          alphaCutoff: mat.alphaCutoff,
          doubleSided: mat.doubleSided,
          vrm: vrmProp ? {
            shader: vrmProp.shader,
            renderQueue: vrmProp.renderQueue,
            floatProperties: vrmProp.floatProperties,
            vectorProperties: vrmProp.vectorProperties,
            textureProperties: vrmProp.textureProperties,
            keywordMap: vrmProp.keywordMap,
            tagMap: vrmProp.tagMap
          } : null
        });
      }
      return materials;
    }

    _parseMeshes() {
      const meshes = [];
      for (const mesh of this.gltf.meshes || []) {
        meshes.push({
          name: mesh.name,
          primitives: mesh.primitives.map(p => ({
            attributes: p.attributes,
            indices: p.indices,
            material: p.material,
            mode: p.mode,
            targets: p.targets || []
          })),
          weights: mesh.weights || []
        });
      }
      return meshes;
    }

    getMeta() { return this.meta; }
    getHumanoidBones() { return this.humanoid?.humanBones || []; }
    getBlendShapeCount() { return this.blendShapeMaster?.blendShapeGroups?.length || 0; }
    getSpringBoneCount() { return this.springBone?.springBoneGroups?.length || 0; }
    getMaterialCount() { return this.gltf.materials?.length || 0; }
    getNodeCount() { return this.gltf.nodes?.length || 0; }
    dispose() { this.json = null; this.binaryChunks = []; this.gltf = null; this.vrmExtension = null; }
  }

  // ============================================================
  // 格式转换器
  // ============================================================
  class ModelConverter {
    constructor() {
      this.supportedFormats = ['pmx', 'gltf', 'glb', 'obj', 'fbx', 'vrm', 'vmd'];
      this.conversionRules = new Map();
      this._initConversionRules();
    }

    _initConversionRules() {
      this.conversionRules.set('pmx-to-gltf', { requires: ['pmx'], output: 'gltf', handler: this._pmxToGltf.bind(this) });
      this.conversionRules.set('obj-to-gltf', { requires: ['obj'], output: 'gltf', handler: this._objToGltf.bind(this) });
      this.conversionRules.set('gltf-to-obj', { requires: ['gltf'], output: 'obj', handler: this._gltfToObj.bind(this) });
      this.conversionRules.set('pmx-to-obj', { requires: ['pmx'], output: 'obj', handler: this._pmxToObj.bind(this) });
    }

    convert(model, fromFormat, toFormat, options = {}) {
      const key = `${fromFormat}-to-${toFormat}`;
      const rule = this.conversionRules.get(key);
      if (!rule) throw new Error(`Unsupported conversion: ${fromFormat} -> ${toFormat}`);
      return rule.handler(model, options);
    }

    _pmxToGltf(pmxModel, options = {}) {
      const gltf = {
        asset: { version: '2.0', generator: 'OrbEngine ModelConverter' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: pmxModel.modelName || 'PMXModel', mesh: 0 }],
        meshes: [{
          name: pmxModel.modelName || 'Mesh',
          primitives: [{
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0
          }]
        }],
        materials: pmxModel.materials.map(m => ({
          name: m.name,
          pbrMetallicRoughness: {
            baseColorFactor: [...m.diffuse],
            metallicFactor: 0,
            roughnessFactor: 0.5
          },
          alphaMode: m.diffuse[3] < 1 ? 'BLEND' : 'OPAQUE',
          doubleSided: true
        })),
        accessors: [],
        bufferViews: [],
        buffers: [{ byteLength: 0, uri: 'data:application/octet-stream;base64,' }]
      };
      const vertexCount = pmxModel.vertexCount;
      const positionData = new Float32Array(vertexCount * 3);
      const normalData = new Float32Array(vertexCount * 3);
      const uvData = new Float32Array(vertexCount * 2);
      const stride = 3 + 3 + 2 + (pmxModel.additionalVec4 || 0) * 4;
      for (let i = 0; i < vertexCount; i++) {
        positionData[i*3] = pmxModel.vertexData[i*stride];
        positionData[i*3+1] = pmxModel.vertexData[i*stride+1];
        positionData[i*3+2] = pmxModel.vertexData[i*stride+2];
        normalData[i*3] = pmxModel.vertexData[i*stride+3];
        normalData[i*3+1] = pmxModel.vertexData[i*stride+4];
        normalData[i*3+2] = pmxModel.vertexData[i*stride+5];
        uvData[i*2] = pmxModel.vertexData[i*stride+6];
        uvData[i*2+1] = pmxModel.vertexData[i*stride+7];
      }
      const indexData = new Uint32Array(pmxModel.indices);
      const buffers = [positionData, normalData, uvData, indexData];
      const types = [5126, 5126, 5126, 5125];
      const components = [3, 3, 2, 1];
      let byteOffset = 0;
      for (let i = 0; i < buffers.length; i++) {
        const data = buffers[i];
        const byteLength = data.byteLength;
        gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength, target: i < 3 ? 34962 : 34963 });
        gltf.accessors.push({
          bufferView: i,
          componentType: types[i],
          count: data.length / components[i],
          type: components[i] === 1 ? 'SCALAR' : components[i] === 2 ? 'VEC2' : 'VEC3',
          min: i === 0 ? this._computeMin(positionData) : undefined,
          max: i === 0 ? this._computeMax(positionData) : undefined
        });
        byteOffset += byteLength;
      }
      gltf.buffers[0].byteLength = byteOffset;
      return gltf;
    }

    _computeMin(data) {
      let min = [Infinity, Infinity, Infinity];
      for (let i = 0; i < data.length; i += 3) {
        if (data[i] < min[0]) min[0] = data[i];
        if (data[i+1] < min[1]) min[1] = data[i+1];
        if (data[i+2] < min[2]) min[2] = data[i+2];
      }
      return min;
    }

    _computeMax(data) {
      let max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 3) {
        if (data[i] > max[0]) max[0] = data[i];
        if (data[i+1] > max[1]) max[1] = data[i+1];
        if (data[i+2] > max[2]) max[2] = data[i+2];
      }
      return max;
    }

    _objToGltf(objModel, options = {}) {
      const gltf = {
        asset: { version: '2.0', generator: 'OrbEngine ModelConverter' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: objModel.name || 'OBJModel', mesh: 0 }],
        meshes: [{ name: objModel.name || 'Mesh', primitives: [] }],
        materials: [],
        accessors: [],
        bufferViews: [],
        buffers: [{ byteLength: 0 }]
      };
      for (const mesh of objModel.meshes || []) {
        const primitive = {
          attributes: { POSITION: gltf.accessors.length },
          indices: gltf.accessors.length + 1
        };
        const posData = new Float32Array(mesh.vertices);
        const idxData = new Uint32Array(mesh.indices);
        gltf.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: posData.byteLength, target: 34962 });
        gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count: posData.length / 3, type: 'VEC3' });
        gltf.bufferViews.push({ buffer: 0, byteOffset: posData.byteLength, byteLength: idxData.byteLength, target: 34963 });
        gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5125, count: idxData.length, type: 'SCALAR' });
        if (mesh.materialIndex !== undefined) primitive.material = mesh.materialIndex;
        gltf.meshes[0].primitives.push(primitive);
      }
      return gltf;
    }

    _gltfToObj(gltfModel, options = {}) {
      const obj = { name: gltfModel.asset?.generator || 'gltf', meshes: [], materials: [] };
      let vertexOffset = 0;
      for (const mesh of gltfModel.meshes || []) {
        for (const primitive of mesh.primitives || []) {
          const positions = this._getAccessorData(gltfModel, primitive.attributes.POSITION);
          const indices = primitive.indices !== undefined ? this._getAccessorData(gltfModel, primitive.indices) : null;
          const meshData = {
            name: mesh.name,
            vertices: Array.from(positions),
            indices: indices ? Array.from(indices) : this._generateIndices(positions.length / 3),
            materialIndex: primitive.material
          };
          obj.meshes.push(meshData);
        }
      }
      for (const mat of gltfModel.materials || []) {
        obj.materials.push({
          name: mat.name,
          diffuse: mat.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1],
          metallic: mat.pbrMetallicRoughness?.metallicFactor || 0,
          roughness: mat.pbrMetallicRoughness?.roughnessFactor || 0.5
        });
      }
      return obj;
    }

    _pmxToObj(pmxModel, options = {}) {
      const obj = { name: pmxModel.modelName || 'PMXModel', meshes: [], materials: [] };
      const vertexCount = pmxModel.vertexCount;
      const stride = 3 + 3 + 2 + (pmxModel.additionalVec4 || 0) * 4;
      const vertices = [];
      const normals = [];
      const uvs = [];
      for (let i = 0; i < vertexCount; i++) {
        vertices.push(pmxModel.vertexData[i*stride], pmxModel.vertexData[i*stride+1], pmxModel.vertexData[i*stride+2]);
        normals.push(pmxModel.vertexData[i*stride+3], pmxModel.vertexData[i*stride+4], pmxModel.vertexData[i*stride+5]);
        uvs.push(pmxModel.vertexData[i*stride+6], pmxModel.vertexData[i*stride+7]);
      }
      obj.meshes.push({
        name: pmxModel.modelName || 'Mesh',
        vertices,
        normals,
        uvs,
        indices: Array.from(pmxModel.indices)
      });
      for (const mat of pmxModel.materials) {
        obj.materials.push({
          name: mat.name,
          diffuse: [...mat.diffuse],
          specular: [...mat.specular],
          ambient: [...mat.ambient],
          shininess: mat.specularPower,
          opacity: mat.diffuse[3]
        });
      }
      return obj;
    }

    _getAccessorData(gltf, accessorIndex) {
      const accessor = gltf.accessors[accessorIndex];
      if (!accessor) return new Float32Array(0);
      const bufferView = gltf.bufferViews[accessor.bufferView];
      const buffer = gltf.buffers[bufferView.buffer];
      const data = buffer.data || new ArrayBuffer(buffer.byteLength);
      const offset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      const componentSize = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 4;
      const componentCount = accessor.type === 'SCALAR' ? 1 : accessor.type === 'VEC2' ? 2 : accessor.type === 'VEC3' ? 3 : 4;
      const totalComponents = accessor.count * componentCount;
      if (accessor.componentType === 5125) return new Uint32Array(data, offset, totalComponents);
      if (accessor.componentType === 5123) return new Uint16Array(data, offset, totalComponents);
      return new Float32Array(data, offset, totalComponents);
    }

    _generateIndices(vertexCount) {
      const indices = [];
      for (let i = 0; i < vertexCount; i++) indices.push(i);
      return indices;
    }

    getSupportedFormats() { return [...this.supportedFormats]; }
    canConvert(from, to) { return this.conversionRules.has(`${from}-to-${to}`); }
    getConversionChains() {
      return Array.from(this.conversionRules.keys()).map(k => k.split('-to-'));
    }
    dispose() { this.conversionRules.clear(); }
  }

  // ============================================================
  // 动画压缩器
  // ============================================================
  class AnimationCompressor {
    constructor() {
      this.quality = 0.01;
      this.maxError = 0.001;
      this.method = 'keyframe_reduction';
      this.quantizationBits = 16;
      this.useDeltaEncoding = true;
      this.useRunLengthEncoding = false;
    }

    compress(animationData, options = {}) {
      const quality = options.quality || this.quality;
      const maxError = options.maxError || this.maxError;
      const method = options.method || this.method;
      if (method === 'keyframe_reduction') return this._keyframeReduction(animationData, maxError);
      if (method === 'quantization') return this._quantize(animationData, options.bits || this.quantizationBits);
      if (method === 'delta') return this._deltaEncode(animationData);
      return animationData;
    }

    decompress(compressedData, options = {}) {
      if (compressedData.method === 'quantization') return this._dequantize(compressedData);
      if (compressedData.method === 'delta') return this._deltaDecode(compressedData);
      return compressedData;
    }

    _keyframeReduction(animationData, maxError) {
      const result = { ...animationData, tracks: [], originalSize: 0, compressedSize: 0 };
      for (const track of animationData.tracks || []) {
        const compressedTrack = { ...track, times: [], values: [] };
        const times = track.times;
        const values = track.values;
        const valueSize = values.length / times.length;
        compressedTrack.times.push(times[0]);
        for (let i = 0; i < valueSize; i++) compressedTrack.values.push(values[i]);
        for (let i = 1; i < times.length - 1; i++) {
          const t = times[i];
          const t0 = compressedTrack.times[compressedTrack.times.length - 1];
          const t1 = times[i + 1];
          let maxDeviation = 0;
          for (let j = 0; j < valueSize; j++) {
            const v0 = compressedTrack.values[(compressedTrack.values.length / valueSize - 1) * valueSize + j];
            const v1 = values[(i + 1) * valueSize + j];
            const interpolated = v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
            const actual = values[i * valueSize + j];
            const deviation = Math.abs(interpolated - actual);
            if (deviation > maxDeviation) maxDeviation = deviation;
          }
          if (maxDeviation > maxError) {
            compressedTrack.times.push(t);
            for (let j = 0; j < valueSize; j++) compressedTrack.values.push(values[i * valueSize + j]);
          }
        }
        compressedTrack.times.push(times[times.length - 1]);
        for (let j = 0; j < valueSize; j++) compressedTrack.values.push(values[(times.length - 1) * valueSize + j]);
        result.tracks.push(compressedTrack);
        result.originalSize += times.length * valueSize * 4;
        result.compressedSize += compressedTrack.times.length * valueSize * 4;
      }
      result.compressionRatio = result.originalSize > 0 ? result.compressedSize / result.originalSize : 1;
      return result;
    }

    _quantize(animationData, bits) {
      const result = { ...animationData, method: 'quantization', bits, tracks: [] };
      const maxVal = (1 << bits) - 1;
      for (const track of animationData.tracks || []) {
        const values = track.values;
        let min = Infinity, max = -Infinity;
        for (const v of values) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const range = max - min || 1;
        const quantized = new Uint32Array(values.length);
        for (let i = 0; i < values.length; i++) {
          quantized[i] = Math.round(((values[i] - min) / range) * maxVal);
        }
        result.tracks.push({
          ...track,
          quantizedValues: Array.from(quantized),
          min, max, range,
          valueCount: values.length
        });
      }
      return result;
    }

    _dequantize(compressedData) {
      const result = { ...compressedData, tracks: [] };
      const maxVal = (1 << compressedData.bits) - 1;
      for (const track of compressedData.tracks || []) {
        const values = new Float32Array(track.valueCount);
        for (let i = 0; i < track.valueCount; i++) {
          values[i] = track.min + (track.quantizedValues[i] / maxVal) * track.range;
        }
        result.tracks.push({ ...track, values: Array.from(values) });
      }
      return result;
    }

    _deltaEncode(animationData) {
      const result = { ...animationData, method: 'delta', tracks: [] };
      for (const track of animationData.tracks || []) {
        const values = track.values;
        const deltas = new Float32Array(values.length);
        deltas[0] = values[0];
        for (let i = 1; i < values.length; i++) deltas[i] = values[i] - values[i - 1];
        result.tracks.push({ ...track, deltaValues: Array.from(deltas), valueCount: values.length });
      }
      return result;
    }

    _deltaDecode(compressedData) {
      const result = { ...compressedData, tracks: [] };
      for (const track of compressedData.tracks || []) {
        const values = new Float32Array(track.valueCount);
        values[0] = track.deltaValues[0];
        for (let i = 1; i < track.valueCount; i++) values[i] = values[i - 1] + track.deltaValues[i];
        result.tracks.push({ ...track, values: Array.from(values) });
      }
      return result;
    }

    setQuality(v) { this.quality = Math.max(0, Math.min(1, v)); }
    setMaxError(v) { this.maxError = v; }
    setMethod(m) { if (['keyframe_reduction', 'quantization', 'delta'].includes(m)) this.method = m; }
    setQuantizationBits(b) { this.quantizationBits = Math.max(4, Math.min(32, b)); }
    dispose() {}
  }

  // ============================================================
  // 骨骼重定向器
  // ============================================================
  class SkeletonRetargeter {
    constructor() {
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.boneMapping = new Map();
      this.retargetedPose = null;
      this.scaleFactor = 1;
      this.rootMotion = true;
      this.preserveOrientation = true;
    }

    setSourceSkeleton(skeleton) {
      this.sourceSkeleton = skeleton;
      this._autoMapBones();
    }

    setTargetSkeleton(skeleton) {
      this.targetSkeleton = skeleton;
      this._computeScaleFactor();
    }

    _autoMapBones() {
      this.boneMapping.clear();
      const standardBones = {
        'hips': ['hips', 'root', 'pelvis', 'center', '腰', '上半身'],
        'spine': ['spine', 'spine1', 'spine2', 'back', '上半身2', '上半身3'],
        'chest': ['chest', 'upperChest', '胸'],
        'neck': ['neck', '首'],
        'head': ['head', '头'],
        'leftShoulder': ['leftShoulder', 'lShoulder', '左肩'],
        'leftUpperArm': ['leftUpperArm', 'lUpperArm', '左腕'],
        'leftLowerArm': ['leftLowerArm', 'lLowerArm', '左ひじ'],
        'leftHand': ['leftHand', 'lHand', '左手首'],
        'rightShoulder': ['rightShoulder', 'rShoulder', '右肩'],
        'rightUpperArm': ['rightUpperArm', 'rUpperArm', '右腕'],
        'rightLowerArm': ['rightLowerArm', 'rLowerArm', '右ひじ'],
        'rightHand': ['rightHand', 'rHand', '右手首'],
        'leftUpperLeg': ['leftUpperLeg', 'lUpperLeg', '左足'],
        'leftLowerLeg': ['leftLowerLeg', 'lLowerLeg', '左ひざ'],
        'leftFoot': ['leftFoot', 'lFoot', '左足首'],
        'leftToes': ['leftToes', 'lToes', '左つま先'],
        'rightUpperLeg': ['rightUpperLeg', 'rUpperLeg', '右足'],
        'rightLowerLeg': ['rightLowerLeg', 'rLowerLeg', '右ひざ'],
        'rightFoot': ['rightFoot', 'rFoot', '右足首'],
        'rightToes': ['rightToes', 'rToes', '右つま先']
      };
      if (!this.sourceSkeleton || !this.targetSkeleton) return;
      for (const [standardName, aliases] of Object.entries(standardBones)) {
        const sourceBone = this._findBone(this.sourceSkeleton, aliases);
        const targetBone = this._findBone(this.targetSkeleton, aliases);
        if (sourceBone !== -1 && targetBone !== -1) {
          this.boneMapping.set(targetBone, sourceBone);
        }
      }
    }

    _findBone(skeleton, aliases) {
      const bones = skeleton.bones || skeleton;
      for (let i = 0; i < bones.length; i++) {
        const name = (bones[i].name || '').toLowerCase().replace(/\s/g, '');
        for (const alias of aliases) {
          if (name === alias.toLowerCase() || name.includes(alias.toLowerCase())) {
            return i;
          }
        }
      }
      return -1;
    }

    _computeScaleFactor() {
      if (!this.sourceSkeleton || !this.targetSkeleton) return;
      const sourceHeight = this._computeSkeletonHeight(this.sourceSkeleton);
      const targetHeight = this._computeSkeletonHeight(this.targetSkeleton);
      this.scaleFactor = sourceHeight > 0 ? targetHeight / sourceHeight : 1;
    }

    _computeSkeletonHeight(skeleton) {
      const bones = skeleton.bones || skeleton;
      let minY = Infinity, maxY = -Infinity;
      for (const bone of bones) {
        const y = bone.position?.[1] || 0;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return maxY - minY;
    }

    retargetPose(sourcePose) {
      if (!this.sourceSkeleton || !this.targetSkeleton) return null;
      const targetBones = this.targetSkeleton.bones || this.targetSkeleton;
      const sourceBones = this.sourceSkeleton.bones || this.sourceSkeleton;
      const result = { bones: [], boneCount: targetBones.length };
      for (let i = 0; i < targetBones.length; i++) {
        const sourceIndex = this.boneMapping.get(i);
        if (sourceIndex !== undefined && sourcePose.bones?.[sourceIndex]) {
          const sourceBonePose = sourcePose.bones[sourceIndex];
          const targetBone = {
            position: this.rootMotion && i === 0 ? [
              sourceBonePose.position[0] * this.scaleFactor,
              sourceBonePose.position[1] * this.scaleFactor,
              sourceBonePose.position[2] * this.scaleFactor
            ] : [0, 0, 0],
            rotation: this.preserveOrientation ? [...sourceBonePose.rotation] : [0, 0, 0, 1],
            scale: [1, 1, 1]
          };
          result.bones.push(targetBone);
        } else {
          result.bones.push({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
        }
      }
      this.retargetedPose = result;
      return result;
    }

    retargetAnimation(sourceAnimation) {
      const result = { name: sourceAnimation.name, duration: sourceAnimation.duration, frames: [] };
      for (const frame of sourceAnimation.frames || []) {
        const retargetedFrame = this.retargetPose(frame);
        result.frames.push(retargetedFrame);
      }
      return result;
    }

    setBoneMapping(targetIndex, sourceIndex) {
      this.boneMapping.set(targetIndex, sourceIndex);
    }

    clearBoneMapping() { this.boneMapping.clear(); }

    getBoneMapping() { return Object.fromEntries(this.boneMapping); }

    getMappedBoneCount() { return this.boneMapping.size; }

    setRootMotion(v) { this.rootMotion = v; }

    setPreserveOrientation(v) { this.preserveOrientation = v; }

    getScaleFactor() { return this.scaleFactor; }

    dispose() {
      this.sourceSkeleton = null;
      this.targetSkeleton = null;
      this.boneMapping.clear();
      this.retargetedPose = null;
    }
  }

  return {
    FBXParser, VRMParser, ModelConverter, AnimationCompressor, SkeletonRetargeter
  };
})();

if (typeof window !== 'undefined') window.ModelFormatsExt = ModelFormatsExt;
if (typeof globalThis !== 'undefined') globalThis.ModelFormatsExt = ModelFormatsExt;
