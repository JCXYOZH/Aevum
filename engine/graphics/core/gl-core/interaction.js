
// ============================================================
// 模块五：交互系统 InteractionSystem (约1200行)
// 射线拾取 / 碰撞检测 / 拖拽 / 触摸响应 / 悬停检测
// ============================================================

const OrbInteraction = (function(){
  const { Vec3, Quat, Mat4, clamp, lerp, EPSILON } = OrbMath;

  // ============================================================
  // Ray - 射线
  // ============================================================
  class Ray {
    constructor(origin = new Vec3(), direction = new Vec3(0, 0, -1)){
      this.origin = origin.clone();
      this.direction = direction.clone().normalize();
    }

    set(origin, direction){
      this.origin.copy(origin);
      this.direction.copy(direction).normalize();
      return this;
    }

    copy(ray){
      this.origin.copy(ray.origin);
      this.direction.copy(ray.direction);
      return this;
    }

    clone(){
      return new Ray(this.origin, this.direction);
    }

    at(t, target = new Vec3()){
      return target.copy(this.origin).add(this.direction.clone().mul(t));
    }

    distanceToPoint(point){
      const v = Vec3.sub(point, this.origin);
      const projection = v.dot(this.direction);
      if(projection < 0) return this.origin.distanceTo(point);
      const closest = this.at(projection);
      return closest.distanceTo(point);
    }

    closestPointToPoint(point, target = new Vec3()){
      const v = Vec3.sub(point, this.origin);
      const projection = Math.max(0, v.dot(this.direction));
      return this.at(projection, target);
    }

    intersectSphere(center, radius){
      const oc = Vec3.sub(this.origin, center);
      const a = this.direction.dot(this.direction);
      const b = 2 * oc.dot(this.direction);
      const c = oc.dot(oc) - radius * radius;
      const discriminant = b * b - 4 * a * c;

      if(discriminant < 0) return null;

      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);

      if(t1 >= 0) return {t: t1, point: this.at(t1)};
      if(t2 >= 0) return {t: t2, point: this.at(t2)};
      return null;
    }

    intersectPlane(planePoint, planeNormal){
      const denom = planeNormal.dot(this.direction);
      if(Math.abs(denom) < EPSILON) return null;

      const t = Vec3.sub(planePoint, this.origin).dot(planeNormal) / denom;
      if(t < 0) return null;

      return {t, point: this.at(t)};
    }

    intersectBox(min, max){
      let tmin = -Infinity, tmax = Infinity;

      for(let i = 0; i < 3; i++){
        const origin = this.origin['xyz'[i]];
        const dir = this.direction['xyz'[i]];
        const minVal = min['xyz'[i]];
        const maxVal = max['xyz'[i]];

        if(Math.abs(dir) < EPSILON){
          if(origin < minVal || origin > maxVal) return null;
        } else {
          let t1 = (minVal - origin) / dir;
          let t2 = (maxVal - origin) / dir;
          if(t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if(tmin > tmax) return null;
        }
      }

      if(tmax < 0) return null;
      const t = tmin >= 0 ? tmin : tmax;
      return {t, point: this.at(t)};
    }

    intersectTriangle(a, b, c, backfaceCulling = true){
      const edge1 = Vec3.sub(b, a);
      const edge2 = Vec3.sub(c, a);
      const pvec = Vec3.cross(this.direction, edge2);
      const det = edge1.dot(pvec);

      if(backfaceCulling && det < EPSILON) return null;
      if(Math.abs(det) < EPSILON) return null;

      const invDet = 1 / det;
      const tvec = Vec3.sub(this.origin, a);
      const u = tvec.dot(pvec) * invDet;

      if(u < 0 || u > 1) return null;

      const qvec = Vec3.cross(tvec, edge1);
      const v = this.direction.dot(qvec) * invDet;

      if(v < 0 || u + v > 1) return null;

      const t = edge2.dot(qvec) * invDet;
      if(t < 0) return null;

      return {t, point: this.at(t), u, v};
    }
  }

  // ============================================================
  // BoundingVolume - 包围体基类
  // ============================================================
  class BoundingVolume {
    constructor(){
      this.min = new Vec3(Infinity, Infinity, Infinity);
      this.max = new Vec3(-Infinity, -Infinity, -Infinity);
      this.center = new Vec3();
      this.radius = 0;
      this.dirty = true;
    }

    expandByPoint(point){
      this.min.min(point);
      this.max.max(point);
      this.dirty = true;
      return this;
    }

    expandByVolume(volume){
      this.expandByPoint(volume.min);
      this.expandByPoint(volume.max);
      return this;
    }

    compute(){
      this.center.copy(this.min).add(this.max).mul(0.5);
      this.radius = this.min.distanceTo(this.max) * 0.5;
      this.dirty = false;
      return this;
    }

    containsPoint(point){
      return point.x >= this.min.x && point.x <= this.max.x &&
             point.y >= this.min.y && point.y <= this.max.y &&
             point.z >= this.min.z && point.z <= this.max.z;
    }

    intersectsVolume(volume){
      return this.min.x <= volume.max.x && this.max.x >= volume.min.x &&
             this.min.y <= volume.max.y && this.max.y >= volume.min.y &&
             this.min.z <= volume.max.z && this.max.z >= volume.min.z;
    }

    intersectsRay(ray){
      return ray.intersectBox(this.min, this.max) !== null;
    }

    getSize(target = new Vec3()){
      return target.copy(this.max).sub(this.min);
    }

    getCenter(target = new Vec3()){
      if(this.dirty) this.compute();
      return target.copy(this.center);
    }

    clone(){
      const bv = new BoundingVolume();
      bv.min.copy(this.min);
      bv.max.copy(this.max);
      bv.center.copy(this.center);
      bv.radius = this.radius;
      bv.dirty = this.dirty;
      return bv;
    }
  }

  // ============================================================
  // Pickable - 可拾取对象
  // ============================================================
  class Pickable {
    constructor(name = '', data = {}){
      this.name = name;
      this.data = data;
      this.boundingVolume = new BoundingVolume();
      this.vertices = [];     // 顶点数组（用于精确拾取）
      this.indices = [];      // 索引数组
      this.transform = new Mat4();
      this.enabled = true;
      this.userData = {};
    }

    setBoundingFromVertices(vertices){
      this.vertices = vertices;
      this.boundingVolume = new BoundingVolume();
      for(const v of vertices){
        this.boundingVolume.expandByPoint(v);
      }
      this.boundingVolume.compute();
    }

    intersectRay(ray, precise = false){
      if(!this.enabled) return null;

      // 先检测包围体
      const localRay = ray.clone();
      // 将射线转换到局部空间
      const invTransform = this.transform.clone().inverse();
      localRay.origin.applyMatrix4(invTransform);
      // 方向需要特殊处理（去除平移）
      const dirMatrix = invTransform.clone();
      dirMatrix.elements[12] = 0;
      dirMatrix.elements[13] = 0;
      dirMatrix.elements[14] = 0;
      localRay.direction.applyMatrix4(dirMatrix).normalize();

      if(!this.boundingVolume.intersectsRay(localRay)){
        return null;
      }

      if(!precise || this.indices.length === 0){
        const hit = localRay.intersectBox(this.boundingVolume.min, this.boundingVolume.max);
        if(hit){
          hit.point.applyMatrix4(this.transform);
          return {object: this, ...hit};
        }
        return null;
      }

      // 精确三角形检测
      let closest = null;
      for(let i = 0; i < this.indices.length; i += 3){
        const a = this.vertices[this.indices[i]];
        const b = this.vertices[this.indices[i + 1]];
        const c = this.vertices[this.indices[i + 2]];

        const hit = localRay.intersectTriangle(a, b, c, false);
        if(hit && (!closest || hit.t < closest.t)){
          closest = {object: this, ...hit, faceIndex: i / 3};
        }
      }

      if(closest){
        closest.point.applyMatrix4(this.transform);
      }

      return closest;
    }
  }

  // ============================================================
  // Picker - 拾取器
  // ============================================================
  class Picker {
    constructor(camera = null, canvas = null){
      this.camera = camera;
      this.canvas = canvas;
      this.objects = [];
      this.ray = new Ray();
      this.precise = true;
      this.enabled = true;
    }

    setCamera(camera){
      this.camera = camera;
    }

    setCanvas(canvas){
      this.canvas = canvas;
    }

    addObject(object){
      this.objects.push(object);
      return object;
    }

    removeObject(object){
      const idx = this.objects.indexOf(object);
      if(idx >= 0) this.objects.splice(idx, 1);
    }

    clear(){
      this.objects = [];
    }

    setFromCamera(screenX, screenY){
      if(!this.camera || !this.canvas) return null;

      const rect = this.canvas.getBoundingClientRect();
      const x = ((screenX - rect.left) / rect.width) * 2 - 1;
      const y = -((screenY - rect.top) / rect.height) * 2 + 1;

      // 计算射线原点和方向
      const origin = new Vec3();
      const direction = new Vec3();

      if(this.camera.isPerspective){
        // 透视相机
        origin.copy(this.camera.position);
        const target = new Vec3(x, y, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
        direction.copy(target).sub(origin).normalize();
      } else {
        // 正交相机
        origin.set(x, y, -1).applyMatrix4(this.camera.projectionMatrixInverse);
        direction.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      }

      this.ray.set(origin, direction);
      return this.ray;
    }

    pick(screenX, screenY, filter = null){
      if(!this.enabled) return [];

      this.setFromCamera(screenX, screenY);

      const hits = [];
      for(const obj of this.objects){
        if(!obj.enabled) continue;
        if(filter && !filter(obj)) continue;

        const hit = obj.intersectRay(this.ray, this.precise);
        if(hit) hits.push(hit);
      }

      // 按距离排序
      hits.sort((a, b) => a.t - b.t);
      return hits;
    }

    pickFirst(screenX, screenY, filter = null){
      const hits = this.pick(screenX, screenY, filter);
      return hits.length > 0 ? hits[0] : null;
    }
  }

  // ============================================================
  // DragController - 拖拽控制器
  // ============================================================
  class DragController {
    constructor(picker, canvas = null){
      this.picker = picker;
      this.canvas = canvas || picker.canvas;
      this.dragging = false;
      this.dragObject = null;
      this.dragPlane = new Vec3(0, 1, 0);
      this.dragOffset = new Vec3();
      this.dragPoint = new Vec3();
      this.constrainAxis = null;  // 'x' | 'y' | 'z' | null
      this.constrainPlane = null; // 'xy' | 'xz' | 'yz' | null
      this.enabled = true;

      this.onDragStart = null;
      this.onDragMove = null;
      this.onDragEnd = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;

      this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      window.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mouseup', (e) => this._onMouseUp(e));

      // 触摸事件
      this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), {passive: false});
      window.addEventListener('touchmove', (e) => this._onTouchMove(e), {passive: false});
      window.addEventListener('touchend', (e) => this._onTouchEnd(e));
    }

    _onMouseDown(e){
      if(!this.enabled || e.button !== 0) return;

      const hit = this.picker.pickFirst(e.clientX, e.clientY);
      if(!hit) return;

      this.dragging = true;
      this.dragObject = hit.object;
      this.dragPoint.copy(hit.point);

      // 计算偏移
      const objectPos = this.dragObject.transform.getPosition();
      this.dragOffset.copy(hit.point).sub(objectPos);

      if(this.onDragStart) this.onDragStart(this.dragObject, hit);
    }

    _onMouseMove(e){
      if(!this.dragging || !this.dragObject) return;

      this.picker.setFromCamera(e.clientX, e.clientY);

      // 与拖拽平面相交
      const planePoint = this.dragPoint;
      const hit = this.picker.ray.intersectPlane(planePoint, this.dragPlane);

      if(hit){
        let newPos = hit.point.clone().sub(this.dragOffset);

        // 应用约束
        if(this.constrainAxis){
          const objectPos = this.dragObject.transform.getPosition();
          if(this.constrainAxis !== 'x') newPos.x = objectPos.x;
          if(this.constrainAxis !== 'y') newPos.y = objectPos.y;
          if(this.constrainAxis !== 'z') newPos.z = objectPos.z;
        }

        if(this.constrainPlane){
          const objectPos = this.dragObject.transform.getPosition();
          if(this.constrainPlane === 'xy') newPos.z = objectPos.z;
          if(this.constrainPlane === 'xz') newPos.y = objectPos.y;
          if(this.constrainPlane === 'yz') newPos.x = objectPos.x;
        }

        // 更新变换
        const e = this.dragObject.transform.elements;
        e[12] = newPos.x;
        e[13] = newPos.y;
        e[14] = newPos.z;

        if(this.onDragMove) this.onDragMove(this.dragObject, newPos);
      }
    }

    _onMouseUp(e){
      if(!this.dragging) return;

      if(this.onDragEnd) this.onDragEnd(this.dragObject);

      this.dragging = false;
      this.dragObject = null;
    }

    _onTouchStart(e){
      if(e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseDown({clientX: touch.clientX, clientY: touch.clientY, button: 0});
    }

    _onTouchMove(e){
      if(e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseMove({clientX: touch.clientX, clientY: touch.clientY});
    }

    _onTouchEnd(e){
      this._onMouseUp({});
    }

    setDragPlane(normal){
      this.dragPlane.copy(normal).normalize();
    }

    setConstrainAxis(axis){
      this.constrainAxis = axis;
      this.constrainPlane = null;
    }

    setConstrainPlane(plane){
      this.constrainPlane = plane;
      this.constrainAxis = null;
    }
  }

  // ============================================================
  // HoverDetector - 悬停检测器
  // ============================================================
  class HoverDetector {
    constructor(picker, canvas = null){
      this.picker = picker;
      this.canvas = canvas || picker.canvas;
      this.hoverObject = null;
      this.hoverPoint = null;
      this.enabled = true;
      this.threshold = 5; // 像素阈值

      this.onHoverEnter = null;
      this.onHoverMove = null;
      this.onHoverLeave = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;
      this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      this.canvas.addEventListener('mouseleave', (e) => this._onMouseLeave(e));
    }

    _onMouseMove(e){
      if(!this.enabled) return;

      const hit = this.picker.pickFirst(e.clientX, e.clientY);

      if(hit){
        if(!this.hoverObject || this.hoverObject !== hit.object){
          if(this.hoverObject && this.onHoverLeave) this.onHoverLeave(this.hoverObject);
          this.hoverObject = hit.object;
          if(this.onHoverEnter) this.onHoverEnter(this.hoverObject, hit);
        }
        this.hoverPoint = hit.point;
        if(this.onHoverMove) this.onHoverMove(this.hoverObject, hit);
      } else {
        if(this.hoverObject){
          if(this.onHoverLeave) this.onHoverLeave(this.hoverObject);
          this.hoverObject = null;
          this.hoverPoint = null;
        }
      }
    }

    _onMouseLeave(e){
      if(this.hoverObject){
        if(this.onHoverLeave) this.onHoverLeave(this.hoverObject);
        this.hoverObject = null;
        this.hoverPoint = null;
      }
    }
  }

  // ============================================================
  // TouchHandler - 触摸处理器（手势识别）
  // ============================================================
  class TouchHandler {
    constructor(canvas = null){
      this.canvas = canvas;
      this.touches = [];
      this.gesture = null;
      this.enabled = true;

      this.onTap = null;
      this.onDoubleTap = null;
      this.onLongPress = null;
      this.onSwipe = null;
      this.onPinch = null;
      this.onRotate = null;
      this.onPan = null;

      this._lastTapTime = 0;
      this._lastTapPos = null;
      this._longPressTimer = null;

      this._bindEvents();
    }

    _bindEvents(){
      if(!this.canvas) return;

      this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), {passive: false});
      this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), {passive: false});
      this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
      this.canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e));
    }

    _onTouchStart(e){
      if(!this.enabled) return;
      e.preventDefault();

      this.touches = Array.from(e.touches).map(t => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now()
      }));

      if(this.touches.length === 1){
        // 长按检测
        this._longPressTimer = setTimeout(() => {
          if(this.touches.length === 1 && this.onLongPress){
            this.onLongPress(this.touches[0]);
          }
        }, 500);
      }

      if(this.touches.length === 2){
        this.gesture = 'pinch';
        this._initialPinchDist = this._getPinchDistance();
        this._initialAngle = this._getAngle();
      }
    }

    _onTouchMove(e){
      if(!this.enabled) return;
      e.preventDefault();

      for(const t of e.touches){
        const touch = this.touches.find(tt => tt.id === t.identifier);
        if(touch){
          touch.x = t.clientX;
          touch.y = t.clientY;
        }
      }

      if(this.touches.length === 1){
        const touch = this.touches[0];
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if(dist > 10 && this._longPressTimer){
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }

        if(this.onPan && dist > 5){
          this.onPan({x: touch.x, y: touch.y, dx, dy, dist});
        }
      }

      if(this.touches.length === 2){
        const currentDist = this._getPinchDistance();
        const scale = currentDist / this._initialPinchDist;

        if(this.onPinch){
          this.onPinch({scale, distance: currentDist});
        }

        const currentAngle = this._getAngle();
        const rotation = currentAngle - this._initialAngle;

        if(this.onRotate && Math.abs(rotation) > 1){
          this.onRotate({rotation, angle: currentAngle});
        }
      }
    }

    _onTouchEnd(e){
      if(!this.enabled) return;

      if(this._longPressTimer){
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }

      if(this.touches.length === 1){
        const touch = this.touches[0];
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const duration = Date.now() - touch.startTime;

        if(dist < 10 && duration < 300){
          // 点击
          const now = Date.now();
          if(now - this._lastTapTime < 300 && this._lastTapPos &&
             Math.abs(this._lastTapPos.x - touch.x) < 30 &&
             Math.abs(this._lastTapPos.y - touch.y) < 30){
            // 双击
            if(this.onDoubleTap) this.onDoubleTap(touch);
            this._lastTapTime = 0;
          } else {
            if(this.onTap) this.onTap(touch);
            this._lastTapTime = now;
            this._lastTapPos = {x: touch.x, y: touch.y};
          }
        } else if(dist > 50 && duration < 500){
          // 滑动
          const speed = dist / duration;
          if(this.onSwipe){
            this.onSwipe({
              x: touch.x, y: touch.y,
              dx, dy, dist, speed,
              direction: this._getSwipeDirection(dx, dy)
            });
          }
        }
      }

      this.touches = [];
      this.gesture = null;
    }

    _getPinchDistance(){
      if(this.touches.length < 2) return 0;
      const dx = this.touches[0].x - this.touches[1].x;
      const dy = this.touches[0].y - this.touches[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    _getAngle(){
      if(this.touches.length < 2) return 0;
      const dx = this.touches[1].x - this.touches[0].x;
      const dy = this.touches[1].y - this.touches[0].y;
      return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    _getSwipeDirection(dx, dy){
      if(Math.abs(dx) > Math.abs(dy)){
        return dx > 0 ? 'right' : 'left';
      } else {
        return dy > 0 ? 'down' : 'up';
      }
    }
  }

  // ============================================================
  // InteractionManager - 交互管理器
  // ============================================================
  class InteractionManager {
    constructor(canvas = null, camera = null){
      this.canvas = canvas;
      this.camera = camera;
      this.picker = new Picker(camera, canvas);
      this.dragController = new DragController(this.picker, canvas);
      this.hoverDetector = new HoverDetector(this.picker, canvas);
      this.touchHandler = new TouchHandler(canvas);
      this.enabled = true;
    }

    setCamera(camera){
      this.camera = camera;
      this.picker.setCamera(camera);
    }

    setCanvas(canvas){
      this.canvas = canvas;
      this.picker.setCanvas(canvas);
    }

    addPickable(object){
      return this.picker.addObject(object);
    }

    removePickable(object){
      this.picker.removeObject(object);
    }

    pick(x, y){
      return this.picker.pick(x, y);
    }

    pickFirst(x, y){
      return this.picker.pickFirst(x, y);
    }
  }

  // 导出
  return {
    Ray, BoundingVolume, Pickable, Picker,
    DragController, HoverDetector, TouchHandler, InteractionManager
  };
})();

if(typeof window !== 'undefined'){
  window.OrbInteraction = OrbInteraction;
}