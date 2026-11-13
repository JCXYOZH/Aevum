function createNavMesh(options){
  const nav = {
    _cells: [],
    _width: (options && options.width) || 100,
    _height: (options && options.height) || 100,
    _cellSize: (options && options.cellSize) || 1,
    _obstacles: [],
    _initialized: false
  };

  function init(){
    const cols = Math.ceil(nav._width / nav._cellSize);
    const rows = Math.ceil(nav._height / nav._cellSize);
    nav._cells = [];
    for(let y = 0; y < rows; y++){
      const row = [];
      for(let x = 0; x < cols; x++){
        row.push({ x: x, y: y, walkable: true, cost: 1, region: 0 });
      }
      nav._cells.push(row);
    }
    nav._initialized = true;
  }

  function setWalkable(x, z, walkable){
    const cell = getCellAt(x, z);
    if(cell) cell.walkable = walkable;
  }

  function getCellAt(x, z){
    if(!nav._initialized) return null;
    const cx = Math.floor(x / nav._cellSize);
    const cz = Math.floor(z / nav._cellSize);
    if(cz < 0 || cz >= nav._cells.length || cx < 0 || cx >= nav._cells[0].length) return null;
    return nav._cells[cz][cx];
  }

  function addObstacle(x, z, radius){
    nav._obstacles.push({ x: x, z: z, radius: radius });
    for(let dz = -radius; dz <= radius; dz += nav._cellSize){
      for(let dx = -radius; dx <= radius; dx += nav._cellSize){
        const dist = Math.sqrt(dx*dx + dz*dz);
        if(dist <= radius){
          setWalkable(x + dx, z + dz, false);
        }
      }
    }
  }

  function removeObstacle(x, z, radius){
    for(let i = nav._obstacles.length - 1; i >= 0; i--){
      const obs = nav._obstacles[i];
      if(Math.abs(obs.x - x) < 0.1 && Math.abs(obs.z - z) < 0.1 && Math.abs(obs.radius - radius) < 0.1){
        nav._obstacles.splice(i, 1);
      }
    }
    rebuild();
  }

  function rebuild(){
    init();
    for(let i = 0; i < nav._obstacles.length; i++){
      const obs = nav._obstacles[i];
      for(let dz = -obs.radius; dz <= obs.radius; dz += nav._cellSize){
        for(let dx = -obs.radius; dx <= obs.radius; dx += nav._cellSize){
          const dist = Math.sqrt(dx*dx + dz*dz);
          if(dist <= obs.radius){
            setWalkable(obs.x + dx, obs.z + dz, false);
          }
        }
      }
    }
  }

  function findPath(startX, startZ, endX, endZ){
    if(!nav._initialized) return [];
    const startCell = getCellAt(startX, startZ);
    const endCell = getCellAt(endX, endZ);
    if(!startCell || !endCell || !startCell.walkable || !endCell.walkable) return [];
    const openSet = [startCell];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const cellKey = function(c){ return c.x + ',' + c.y; };
    gScore.set(cellKey(startCell), 0);
    fScore.set(cellKey(startCell), heuristic(startCell, endCell));
    while(openSet.length > 0){
      let current = openSet[0];
      let currentIdx = 0;
      for(let i = 1; i < openSet.length; i++){
        if((fScore.get(cellKey(openSet[i])) || Infinity) < (fScore.get(cellKey(current)) || Infinity)){
          current = openSet[i];
          currentIdx = i;
        }
      }
      if(current === endCell){
        return reconstructPath(cameFrom, current);
      }
      openSet.splice(currentIdx, 1);
      closedSet.add(cellKey(current));
      const neighbors = getNeighbors(current);
      for(let i = 0; i < neighbors.length; i++){
        const neighbor = neighbors[i];
        if(closedSet.has(cellKey(neighbor)) || !neighbor.walkable) continue;
        const tentativeG = (gScore.get(cellKey(current)) || 0) + neighbor.cost;
        if(!openSet.includes(neighbor)){
          openSet.push(neighbor);
        } else if(tentativeG >= (gScore.get(cellKey(neighbor)) || Infinity)){
          continue;
        }
        cameFrom.set(cellKey(neighbor), current);
        gScore.set(cellKey(neighbor), tentativeG);
        fScore.set(cellKey(neighbor), tentativeG + heuristic(neighbor, endCell));
      }
    }
    return [];
  }

  function heuristic(a, b){
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function getNeighbors(cell){
    const neighbors = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
    for(let i = 0; i < dirs.length; i++){
      const nx = cell.x + dirs[i][0];
      const ny = cell.y + dirs[i][1];
      if(ny >= 0 && ny < nav._cells.length && nx >= 0 && nx < nav._cells[0].length){
        neighbors.push(nav._cells[ny][nx]);
      }
    }
    return neighbors;
  }

  function reconstructPath(cameFrom, current){
    const path = [{ x: current.x * nav._cellSize, z: current.y * nav._cellSize }];
    const cellKey = function(c){ return c.x + ',' + c.y; };
    while(cameFrom.has(cellKey(current))){
      current = cameFrom.get(cellKey(current));
      path.unshift({ x: current.x * nav._cellSize, z: current.y * nav._cellSize });
    }
    return path;
  }

  function smoothPath(path){
    if(path.length <= 2) return path;
    const smoothed = [path[0]];
    let lastValid = 0;
    for(let i = 1; i < path.length; i++){
      if(!hasLineOfSight(smoothed[smoothed.length-1], path[i])){
        smoothed.push(path[i-1]);
      }
    }
    smoothed.push(path[path.length-1]);
    return smoothed;
  }

  function hasLineOfSight(a, b){
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const steps = Math.ceil(dist / nav._cellSize);
    for(let i = 0; i <= steps; i++){
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const cell = getCellAt(x, z);
      if(!cell || !cell.walkable) return false;
    }
    return true;
  }

  function getRandomWalkablePosition(){
    if(!nav._initialized) return null;
    for(let attempts = 0; attempts < 100; attempts++){
      const x = Math.random() * nav._width;
      const z = Math.random() * nav._height;
      const cell = getCellAt(x, z);
      if(cell && cell.walkable) return { x: x, z: z };
    }
    return null;
  }

  function clear(){
    nav._cells = [];
    nav._obstacles = [];
    nav._initialized = false;
  }

  return { init, setWalkable, getCellAt, addObstacle, removeObstacle, rebuild, findPath, smoothPath, getRandomWalkablePosition, clear, nav };
}

/* ===== 群体行为系统 =====
   支持: 分离 / 对齐 / 聚合 / 避障 / 追逐
*/
function createFlockingSystem(options){
  const flock = {
    _agents: [],
    _separationWeight: (options && options.separationWeight) || 1.5,
    _alignmentWeight: (options && options.alignmentWeight) || 1,
    _cohesionWeight: (options && options.cohesionWeight) || 1,
    _avoidanceWeight: (options && options.avoidanceWeight) || 2,
    _maxSpeed: (options && options.maxSpeed) || 5,
    _maxForce: (options && options.maxForce) || 0.5,
    _perceptionRadius: (options && options.perceptionRadius) || 5,
    _separationRadius: (options && options.separationRadius) || 2,
    _obstacles: [],
    _bounds: (options && options.bounds) || { minX: -50, maxX: 50, minY: -50, maxY: 50, minZ: -50, maxZ: 50 }
  };

  function createAgent(position, velocity){
    const agent = {
      position: position ? [...position] : [0,0,0],
      velocity: velocity ? [...velocity] : [Math.random()-0.5, 0, Math.random()-0.5],
      acceleration: [0,0,0],
      maxSpeed: flock._maxSpeed,
      maxForce: flock._maxForce,
      active: true
    };
    flock._agents.push(agent);
    return agent;
  }

  function removeAgent(agent){
    const idx = flock._agents.indexOf(agent);
    if(idx >= 0) flock._agents.splice(idx, 1);
  }

  function addObstacle(position, radius){
    flock._obstacles.push({ position: [...position], radius: radius });
  }

  function update(dt){
    for(let i = 0; i < flock._agents.length; i++){
      const agent = flock._agents[i];
      if(!agent.active) continue;
      const separation = computeSeparation(agent);
      const alignment = computeAlignment(agent);
      const cohesion = computeCohesion(agent);
      const avoidance = computeAvoidance(agent);
      const bounds = computeBounds(agent);
      agent.acceleration[0] += separation[0] * flock._separationWeight;
      agent.acceleration[1] += separation[1] * flock._separationWeight;
      agent.acceleration[2] += separation[2] * flock._separationWeight;
      agent.acceleration[0] += alignment[0] * flock._alignmentWeight;
      agent.acceleration[1] += alignment[1] * flock._alignmentWeight;
      agent.acceleration[2] += alignment[2] * flock._alignmentWeight;
      agent.acceleration[0] += cohesion[0] * flock._cohesionWeight;
      agent.acceleration[1] += cohesion[1] * flock._cohesionWeight;
      agent.acceleration[2] += cohesion[2] * flock._cohesionWeight;
      agent.acceleration[0] += avoidance[0] * flock._avoidanceWeight;
      agent.acceleration[1] += avoidance[1] * flock._avoidanceWeight;
      agent.acceleration[2] += avoidance[2] * flock._avoidanceWeight;
      agent.acceleration[0] += bounds[0];
      agent.acceleration[1] += bounds[1];
      agent.acceleration[2] += bounds[2];
      agent.velocity[0] += agent.acceleration[0] * dt;
      agent.velocity[1] += agent.acceleration[1] * dt;
      agent.velocity[2] += agent.acceleration[2] * dt;
      const speed = Math.sqrt(agent.velocity[0]**2 + agent.velocity[1]**2 + agent.velocity[2]**2);
      if(speed > agent.maxSpeed){
        agent.velocity[0] = agent.velocity[0] / speed * agent.maxSpeed;
        agent.velocity[1] = agent.velocity[1] / speed * agent.maxSpeed;
        agent.velocity[2] = agent.velocity[2] / speed * agent.maxSpeed;
      }
      agent.position[0] += agent.velocity[0] * dt;
      agent.position[1] += agent.velocity[1] * dt;
      agent.position[2] += agent.velocity[2] * dt;
      agent.acceleration = [0,0,0];
    }
  }

  function computeSeparation(agent){
    const steer = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._separationRadius){
        const diff = [
          (agent.position[0] - other.position[0]) / d,
          (agent.position[1] - other.position[1]) / d,
          (agent.position[2] - other.position[2]) / d
        ];
        steer[0] += diff[0];
        steer[1] += diff[1];
        steer[2] += diff[2];
        count++;
      }
    }
    if(count > 0){
      steer[0] /= count; steer[1] /= count; steer[2] /= count;
      return limitForce(steer, agent);
    }
    return steer;
  }

  function computeAlignment(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.velocity[0];
        sum[1] += other.velocity[1];
        sum[2] += other.velocity[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] * agent.maxSpeed, sum[1] * agent.maxSpeed, sum[2] * agent.maxSpeed];
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeCohesion(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.position[0];
        sum[1] += other.position[1];
        sum[2] += other.position[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] - agent.position[0], sum[1] - agent.position[1], sum[2] - agent.position[2]];
      const dl = Math.sqrt(desired[0]**2 + desired[1]**2 + desired[2]**2) || 1;
      desired[0] = desired[0]/dl * agent.maxSpeed;
      desired[1] = desired[1]/dl * agent.maxSpeed;
      desired[2] = desired[2]/dl * agent.maxSpeed;
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeAvoidance(agent){
    const steer = [0,0,0];
    for(let i = 0; i < flock._obstacles.length; i++){
      const obs = flock._obstacles[i];
      const d = dist3(agent.position, obs.position);
      if(d < obs.radius + flock._perceptionRadius){
        const diff = [
          (agent.position[0] - obs.position[0]) / (d || 1),
          (agent.position[1] - obs.position[1]) / (d || 1),
          (agent.position[2] - obs.position[2]) / (d || 1)
        ];
        const strength = 1 - (d / (obs.radius + flock._perceptionRadius));
        steer[0] += diff[0] * strength;
        steer[1] += diff[1] * strength;
        steer[2] += diff[2] * strength;
      }
    }
    return limitForce(steer, agent);
  }

  function computeBounds(agent){
    const steer = [0,0,0];
    const b = flock._bounds;
    const margin = 5;
    if(agent.position[0] < b.minX + margin) steer[0] = 1;
    if(agent.position[0] > b.maxX - margin) steer[0] = -1;
    if(agent.position[1] < b.minY + margin) steer[1] = 1;
    if(agent.position[1] > b.maxY - margin) steer[1] = -1;
    if(agent.position[2] < b.minZ + margin) steer[2] = 1;
    if(agent.position[2] > b.maxZ - margin) steer[2] = -1;
    return steer;
  }

  function dist3(a, b){
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }

  function limitForce(force, agent){
    const mag = Math.sqrt(force[0]**2 + force[1]**2 + force[2]**2);
    if(mag > agent.maxForce){
      force[0] = force[0]/mag * agent.maxForce;
      force[1] = force[1]/mag * agent.maxForce;
      force[2] = force[2]/mag * agent.maxForce;
    }
    return force;
  }

  function getAgents(){
    return flock._agents;
  }

  function setWeights(separation, alignment, cohesion, avoidance){
    if(separation !== undefined) flock._separationWeight = separation;
    if(alignment !== undefined) flock._alignmentWeight = alignment;
    if(cohesion !== undefined) flock._cohesionWeight = cohesion;
    if(avoidance !== undefined) flock._avoidanceWeight = avoidance;
  }

  function clear(){
    flock._agents = [];
    flock._obstacles = [];
  }

  return { createAgent, removeAgent, addObstacle, update, getAgents, setWeights, clear, flock };
}

/* ===== 感知系统 =====
   支持: 视觉 / 听觉 / 触觉 / 记忆 / 威胁评估
*/