import * as OBC from "@thatopen/components"
import * as OBCF from "@thatopen/components-front"
import * as BUI from "@thatopen/ui"
import * as THREE from "three"
import { TodoData, TodoInput } from "./base-types"

export class TodoCreator extends OBC.Component implements OBC.Disposable {
  static uuid = "22d0d290-ef67-409e-a1a6-33c20a3b666d"
  enabled = true
  private _world: OBC.World
  private _list: TodoData[] = []
  
  onTodoCreated = new OBC.Event<TodoData>()
  onDisposed = new OBC.Event<null>()

  constructor(components: OBC.Components) {
    super(components)
    this.components.add(TodoCreator.uuid, this)
  }

  async dispose() {
    this.enabled = false
    this._list = []
    this.onDisposed.trigger()
  }

  setup() {
    const highlighter = this.components.get(OBCF.Highlighter)
    highlighter.add(`${TodoCreator.uuid}-priority-Low`, new THREE.Color(0x59bc59))
    highlighter.add(`${TodoCreator.uuid}-priority-Medium`, new THREE.Color(0x597cff))
    highlighter.add(`${TodoCreator.uuid}-priority-High`, new THREE.Color(0xff7676))
  }

  set world(world: OBC.World) {
    this._world = world
  }

  set enablePriorityHighlight(value: boolean) {
    if (!this.enabled) return

    const highlighter = this.components.get(OBCF.Highlighter)
    if (value) {
      for (const todo of this._list) {
        const fragments = this.components.get(OBC.FragmentsManager)
        const fragmentIdMap = fragments.guidToFragmentIdMap(todo.ifcGuids)
        highlighter.highlightByID(`${TodoCreator.uuid}-priority-${todo.priority}`, fragmentIdMap, false, false)
      }
    } else {
      for (const priority of ["Low", "Medium", "High"]) {
        const styleName = `${TodoCreator.uuid}-priority-${priority}`;
        const snap = { ...(highlighter.selection?.[styleName] ?? {}) };
        if (Object.keys(snap).length > 0) {
          void highlighter.clear(styleName, snap);
        }
        if (highlighter.selection?.[styleName]) {
          highlighter.selection[styleName] = {};
        }
      }
    }
  }

  async addTodo(data: TodoInput) {
    if (!this.enabled) return

    const fragments = this.components.get(OBC.FragmentsManager)
    const highlighter = this.components.get(OBCF.Highlighter)
    const guids = fragments.fragmentIdMapToGuids(highlighter.selection.select)

    const camera = this._world.camera

    if (!(camera instanceof OBC.OrthoPerspectiveCamera)) {
      throw new Error("No camera found in the world")
    }

    const position = new THREE.Vector3()
    camera.controls.getPosition(position)
    const target = new THREE.Vector3()
    camera.controls.getTarget(target)

    const todoData: TodoData = {
      name: data.name,
      task: data.task,
      priority: data.priority,
      ifcGuids: guids,
      camera: {
        position,
        target,
      }
    }

    this._list.push(todoData)
    this.onTodoCreated.trigger(todoData)
  }

  async highlightTodo(todo: TodoData) {
    if (!this.enabled) return
    
    const fragments = this.components.get(OBC.FragmentsManager)
    const fragmentIdMap = fragments.guidToFragmentIdMap(todo.ifcGuids)
    const highlighter = this.components.get(OBCF.Highlighter)
    highlighter.highlightByID("select", fragmentIdMap, true, false)

    if (!this._world) {
      throw new Error("No world found")
    }

    const camera = this._world.camera
    if (!(camera.hasCameraControls())) {
      throw new Error("The world camera doesn't have camera controls")
    }

    await camera.controls.setLookAt(
      todo.camera.position.x,
      todo.camera.position.y,
      todo.camera.position.z,
      todo.camera.target.x,
      todo.camera.target.y,
      todo.camera.target.z,
      true
    )
  }

  addTodoMarker(todo: TodoData) {
    if (!this.enabled) return

    if (todo.ifcGuids.length === 0) return

    const fragments = this.components.get(OBC.FragmentsManager)
    const fragmentIdMap = fragments.guidToFragmentIdMap(todo.ifcGuids)
    const boundingBoxer = this.components.get(OBC.BoundingBoxer)
    boundingBoxer.addFragmentIdMap(fragmentIdMap)
    const { center } = boundingBoxer.getSphere()

    const label = BUI.Component.create<BUI.Label>(() => {
      return BUI.html `
        <bim-label
          @mouseover=${() => {
            const highlighter = this.components.get(OBCF.Highlighter)
            highlighter.highlightByID("hover", fragmentIdMap, true, false)
          }}
          style="background-color: var(--bim-ui_bg-contrast-100); cursor: pointer; padding: 0.25rem 0.5rem; border-radius: 999px; pointer-events: auto;"
          icon="fa:map-marker"
        ></bim-label>
      `
    })

    const marker = new OBCF.Mark(this._world, label)
    marker.three.position.copy(center)
  }
}
