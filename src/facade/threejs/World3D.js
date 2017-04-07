import assign from 'lodash/assign'
import map from 'lodash/map'
import {WebGLRenderer, Raycaster, Color, Vector2, Vector3} from 'three'
import WorldBaseFacade from '../WorldBase'
import Scene3DFacade from './Scene3D'
import {PerspectiveCamera3DFacade} from './Camera3D'


const posVec = new Vector3()
const raycaster = new Raycaster()



class World3DFacade extends WorldBaseFacade {
  constructor(canvas, threeJsRendererConfig) {
    super(canvas)

    this._threeRenderer = new WebGLRenderer(assign({
      canvas: canvas,
      alpha: true
    }, threeJsRendererConfig))
  }

  set backgroundColor(color) {
    if (color !== this._bgColor) {
      this._threeRenderer.setClearColor(new Color(color || 0), color != null ? 1 : 0)
      this._bgColor = color
    }
  }
  get backgroundColor() {
    return this._bgColor
  }

  set shadows(val) {
    this._threeRenderer.shadowMap.enabled = !!val
  }

  afterUpdate() {
    let {camera, scene, width, height} = this
    camera.key = 'camera'
    camera.class = camera.class || PerspectiveCamera3DFacade
    if (typeof camera.aspect !== 'number') {
      camera.aspect = width / height
    }
    scene.key = 'scene'
    scene.class = scene.class || Scene3DFacade
    this.children = [camera, scene]

    let renderer = this._threeRenderer

    let pixelRatio = window.devicePixelRatio
    if (renderer.getPixelRatio() !== pixelRatio) {
      renderer.setPixelRatio(pixelRatio)
    }

    let lastSize = renderer.getSize()
    if (lastSize.width !== width || lastSize.height !== height) {
      renderer.setSize(width, height, true)
    }

    super.afterUpdate()
  }

  doRender() {
    let scene = this.getChildByKey('scene').threeObject
    let camera = this.getChildByKey('camera').threeObject

    // Invoke any callbacks registered by addBeforeRenderCallback
    let callbacks = this._beforeRenderFns
    if (callbacks) {
      callbacks.forEach(fn => fn(this._threeRenderer, scene, camera))
      this._beforeRenderFns = null
    }

    this._threeRenderer.render(scene, camera)
  }

  /**
   * Implementation of abstract
   */
  getFacadeUserSpaceXYZ(facade) {
    let camera = this.getChildByKey('camera').threeObject
    posVec.setFromMatrixPosition(facade.threeObject.matrixWorld)
    let distance = posVec.distanceTo(camera.position)
    posVec.project(camera)
    return {
      x: (posVec.x + 1) * this.width / 2,
      y: (1 - posVec.y) * this.height / 2,
      z: distance
    }
  }

  onNotifyWorld(source, message, data) {
    switch(message) {
      case 'getCameraPosition':
        data(this.getChildByKey('camera').threeObject.position) //callback function
        return
      case 'addBeforeRenderCallback':
        ;(this._beforeRenderFns || (this._beforeRenderFns = [])).push(data)
        return
    }
    super.onNotifyWorld(source, message, data)
  }


  /**
   * Implementation of abstract
   */
  getFacadesAtPosition(clientX, clientY, canvasRect) {
    // convert mouse position to normalized device coords (-1 to 1)
    let coords = new Vector2(
      (clientX - canvasRect.left) / canvasRect.width * 2 - 1,
      (clientY - canvasRect.top) / canvasRect.height * -2 + 1
    )

    // ensure camera's matrix is updated
    let camera = this.getChildByKey('camera').threeObject
    camera.updateMatrixWorld()

    // prep raycaster
    raycaster.setFromCamera(coords, camera)

    // traverse tree to collect hits
    let allHits = null
    this.getChildByKey('scene').traverse(facade => {
      let hits = facade.raycast && facade.raycast(raycaster)
      if (hits && hits[0]) {
        (allHits || (allHits = [])).push({
          facade: facade,
          distance: hits[0].distance //ignore all but closest
        })
      }
    })

    return allHits
  }

}

export default World3DFacade
