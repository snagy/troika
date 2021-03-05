import {
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneBufferGeometry,
  Vector4,
  Vector3,
  Vector2,
  BoxBufferGeometry
} from 'three'
import { GlyphsGeometry } from './GlyphsGeometry.js'
import { createTextDerivedMaterial } from './TextDerivedMaterial.js'
import { getTextRenderInfo } from './TextBuilder.js'
import { createDerivedMaterial } from 'troika-three-utils'
import { getSelectionRects, getCaretAtPoint } from './selectionUtils'


const Text = /*#__PURE__*/(() => {

  const defaultMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    side: DoubleSide,
    transparent: true
  })
  const defaultStrokeColor = 0x808080
  const defaultSelectionColor = 0xffffff

  const tempMat4 = new Matrix4()
  const tempVec3a = new Vector3()
  const tempVec3b = new Vector3()
  const tempArray = []
  const origin = new Vector3()
  const defaultOrient = '+x+y'

  function first(o) {
    return Array.isArray(o) ? o[0] : o
  }

  let getFlatRaycastMesh = () => {
    const mesh = new Mesh(
      new PlaneBufferGeometry(1, 1),
      defaultMaterial
    )
    getFlatRaycastMesh = () => mesh
    return mesh
  }
  let getCurvedRaycastMesh = () => {
    const mesh = new Mesh(
      new PlaneBufferGeometry(1, 1, 32, 1),
      defaultMaterial
    )
    getCurvedRaycastMesh = () => mesh
    return mesh
  }

  const syncStartEvent = {type: 'syncstart'}
  const syncCompleteEvent = {type: 'synccomplete'}

  const SYNCABLE_PROPS = [
    'font',
    'fontSize',
    'letterSpacing',
    'lineHeight',
    'maxWidth',
    'overflowWrap',
    'text',
    'textAlign',
    'textIndent',
    'whiteSpace',
    'anchorX',
    'anchorY',
    'colorRanges',
    'sdfGlyphSize'
  ]

  const COPYABLE_PROPS = SYNCABLE_PROPS.concat(
    'material',
    'color',
    'depthOffset',
    'clipRect',
    'orientation',
    'glyphGeometryDetail'
  )



  /**
   * @class Text
   *
   * A ThreeJS Mesh that renders a string of text on a plane in 3D space using signed distance
   * fields (SDF).
   */
  class Text extends Mesh {
    constructor() {

      this._domElSelectedText = document.createElement('p')
      this._domElText = document.createElement(this.tagName ? this.tagName : 'p')
      this.selectionStartIndex = 0;
      this.selectionEndIndex = 0;
      this.selectedText = null;

      if(this.domContainer){
        this.domContainer.appendChild(this._domElSelectedText)
        this.domContainer.appendChild(this._domElText)
      }else{
        document.body.appendChild(this._domElSelectedText)
        document.body.appendChild(this._domElText)
      }

      this._domElSelectedText.setAttribute('aria-hidden','true')
      this._domElText.style = 'position:absolute;left:-99px;opacity:0;overflow:hidden;margin:0px;pointer-events:none;font-size:100vh;display:flex;align-items: center;line-height: 0px!important;line-break: anywhere;'
      this._domElSelectedText.style = 'position:absolute;left:-99px;opacity:0;overflow:hidden;margin:0px;pointer-events:none;font-size:100vh;'

      this.startObservingMutation()

      this.selectionRects = []

      //TODO test html support

      //syncing html on top of text can slow down the page if used with multiple Text instance
      //sometime the text is purely decorative and it makes no sense for it to be accessible, so it should be possible to disable / enable it
      //the default is to be discussed 
      this.supportScreenReader = false
      this.selectable = false

      const geometry = new GlyphsGeometry()
      super(geometry, null)

      // === Text layout properties: === //

      /**
       * @member {string} text
       * The string of text to be rendered.
       */
      this.text = ''
      this.prevText = ''
      this.currentText = ''

      /**
       * @deprecated Use `anchorX` and `anchorY` instead
       * @member {Array<number>} anchor
       * Defines where in the text block should correspond to the mesh's local position, as a set
       * of horizontal and vertical percentages from 0 to 1. A value of `[0, 0]` (the default)
       * anchors at the top-left, `[1, 1]` at the bottom-right, and `[0.5, 0.5]` centers the
       * block at the mesh's position.
       */
      //this.anchor = null

      /**
       * @member {number|string} anchorX
       * Defines the horizontal position in the text block that should line up with the local origin.
       * Can be specified as a numeric x position in local units, a string percentage of the total
       * text block width e.g. `'25%'`, or one of the following keyword strings: 'left', 'center',
       * or 'right'.
       */
      this.anchorX = 0

      /**
       * @member {number|string} anchorX
       * Defines the vertical position in the text block that should line up with the local origin.
       * Can be specified as a numeric y position in local units (note: down is negative y), a string
       * percentage of the total text block height e.g. `'25%'`, or one of the following keyword strings:
       * 'top', 'top-baseline', 'middle', 'bottom-baseline', or 'bottom'.
       */
      this.anchorY = 0

      /**
       * @member {number} curveRadius
       * Defines a cylindrical radius along which the text's plane will be curved. Positive numbers put
       * the cylinder's centerline (oriented vertically) that distance in front of the text, for a concave
       * curvature, while negative numbers put it behind the text for a convex curvature. The centerline
       * will be aligned with the text's local origin; you can use `anchorX` to offset it.
       *
       * Since each glyph is by default rendered with a simple quad, each glyph remains a flat plane
       * internally. You can use `glyphGeometryDetail` to add more vertices for curvature inside glyphs.
       */
      this.curveRadius = 0

      /**
       * @member {string} font
       * URL of a custom font to be used. Font files can be any of the formats supported by
       * OpenType (see https://github.com/opentypejs/opentype.js).
       * Defaults to the Roboto font loaded from Google Fonts.
       */
      this.font = null //will use default from TextBuilder

      /**
       * @member {number} fontSize
       * The size at which to render the font in local units; corresponds to the em-box height
       * of the chosen `font`.
       */
      this.fontSize = 0.1

      /**
       * @member {number} letterSpacing
       * Sets a uniform adjustment to spacing between letters after kerning is applied. Positive
       * numbers increase spacing and negative numbers decrease it.
       */
      this.letterSpacing = 0

      /**
       * @member {number|string} lineHeight
       * Sets the height of each line of text, as a multiple of the `fontSize`. Defaults to 'normal'
       * which chooses a reasonable height based on the chosen font's ascender/descender metrics.
       */
      this.lineHeight = 'normal'

      /**
       * @member {number} maxWidth
       * The maximum width of the text block, above which text may start wrapping according to the
       * `whiteSpace` and `overflowWrap` properties.
       */
      this.maxWidth = Infinity

      /**
       * @member {string} overflowWrap
       * Defines how text wraps if the `whiteSpace` property is `normal`. Can be either `'normal'`
       * to break at whitespace characters, or `'break-word'` to allow breaking within words.
       * Defaults to `'normal'`.
       */
      this.overflowWrap = 'normal'

      /**
       * @member {string} textAlign
       * The horizontal alignment of each line of text within the overall text bounding box.
       */
      this.textAlign = 'left'

      /**
       * @member {number} textIndent
       * Indentation for the first character of a line; see CSS `text-indent`.
       */
      this.textIndent = 0

      /**
       * @member {string} whiteSpace
       * Defines whether text should wrap when a line reaches the `maxWidth`. Can
       * be either `'normal'` (the default), to allow wrapping according to the `overflowWrap` property,
       * or `'nowrap'` to prevent wrapping. Note that `'normal'` here honors newline characters to
       * manually break lines, making it behave more like `'pre-wrap'` does in CSS.
       */
      this.whiteSpace = 'normal'


      // === Presentation properties: === //

      /**
       * @member {THREE.Material} material
       * Defines a _base_ material to be used when rendering the text. This material will be
       * automatically replaced with a material derived from it, that adds shader code to
       * decrease the alpha for each fragment (pixel) outside the text glyphs, with antialiasing.
       * By default it will derive from a simple white MeshBasicMaterial, but you can use any
       * of the other mesh materials to gain other features like lighting, texture maps, etc.
       *
       * Also see the `color` shortcut property.
       */
      this.material = null

      /**
       * @member {THREE.Material} selectionMaterial
       * Defines a _base_ material to be used when rendering the text. This material will be
       * automatically replaced with a material derived from it, that adds shader code to
       * decrease the alpha for each fragment (pixel) outside the text glyphs, with antialiasing.
       * By default it will derive from a simple white MeshBasicMaterial, but you can use any
       * of the other mesh materials to gain other features like lighting, texture maps, etc.
       *
       * Also see the `selectionColor` shortcut property.
       */
      this.selectionMaterial = null

      /**
       * @member {string|number|THREE.Color} color
       * This is a shortcut for setting the `color` of the text's material. You can use this
       * if you don't want to specify a whole custom `material`. Also, if you do use a custom
       * `material`, this color will only be used for this particuar Text instance, even if
       * that same material instance is shared across multiple Text objects.
       */
      this.color = null

      /**
       * @member {string|number|THREE.Color} selectionColor
       * This is a shortcut for setting the `color` of the text's material. You can use this
       * if you don't want to specify a whole custom `material`. Also, if you do use a custom
       * `material`, this color will only be used for this particuar Text instance, even if
       * that same material instance is shared across multiple Text objects.
       */
      this.selectionColor = defaultSelectionColor

      /**
       * @member {object|null} colorRanges
       * WARNING: This API is experimental and may change.
       * This allows more fine-grained control of colors for individual or ranges of characters,
       * taking precedence over the material's `color`. Its format is an Object whose keys each
       * define a starting character index for a range, and whose values are the color for each
       * range. The color value can be a numeric hex color value, a `THREE.Color` object, or
       * any of the strings accepted by `THREE.Color`.
       */
      this.colorRanges = null

      /**
       * @member {number|string} outlineWidth
       * WARNING: This API is experimental and may change.
       * The width of an outline/halo to be drawn around each text glyph using the `outlineColor` and `outlineOpacity`.
       * Can be specified as either an absolute number in local units, or as a percentage string e.g.
       * `"12%"` which is treated as a percentage of the `fontSize`. Defaults to `0`, which means
       * no outline will be drawn unless an `outlineOffsetX/Y` or `outlineBlur` is set.
       */
      this.outlineWidth = 0

      /**
       * @member {string|number|THREE.Color} outlineColor
       * WARNING: This API is experimental and may change.
       * The color of the text outline, if `outlineWidth`/`outlineBlur`/`outlineOffsetX/Y` are set.
       * Defaults to black.
       */
      this.outlineColor = 0x000000

      /**
       * @member {number} outlineOpacity
       * WARNING: This API is experimental and may change.
       * The opacity of the outline, if `outlineWidth`/`outlineBlur`/`outlineOffsetX/Y` are set.
       * Defaults to `1`.
       */
      this.outlineOpacity = 1

      /**
       * @member {number|string} outlineBlur
       * WARNING: This API is experimental and may change.
       * A blur radius applied to the outer edge of the text's outline. If the `outlineWidth` is
       * zero, the blur will be applied at the glyph edge, like CSS's `text-shadow` blur radius.
       * Can be specified as either an absolute number in local units, or as a percentage string e.g.
       * `"12%"` which is treated as a percentage of the `fontSize`. Defaults to `0`.
       */
      this.outlineBlur = 0

      /**
       * @member {number|string} outlineOffsetX
       * WARNING: This API is experimental and may change.
       * A horizontal offset for the text outline.
       * Can be specified as either an absolute number in local units, or as a percentage string e.g. `"12%"`
       * which is treated as a percentage of the `fontSize`. Defaults to `0`.
       */
      this.outlineOffsetX = 0

      /**
       * @member {number|string} outlineOffsetY
       * WARNING: This API is experimental and may change.
       * A vertical offset for the text outline.
       * Can be specified as either an absolute number in local units, or as a percentage string e.g. `"12%"`
       * which is treated as a percentage of the `fontSize`. Defaults to `0`.
       */
      this.outlineOffsetY = 0

      /**
       * @member {number|string} strokeWidth
       * WARNING: This API is experimental and may change.
       * The width of an inner stroke drawn inside each text glyph using the `strokeColor` and `strokeOpacity`.
       * Can be specified as either an absolute number in local units, or as a percentage string e.g. `"12%"`
       * which is treated as a percentage of the `fontSize`. Defaults to `0`.
       */
      this.strokeWidth = 0

      /**
       * @member {string|number|THREE.Color} strokeColor
       * WARNING: This API is experimental and may change.
       * The color of the text stroke, if `strokeWidth` is greater than zero. Defaults to gray.
       */
      this.strokeColor = defaultStrokeColor

      /**
       * @member {number} strokeOpacity
       * WARNING: This API is experimental and may change.
       * The opacity of the stroke, if `strokeWidth` is greater than zero. Defaults to `1`.
       */
      this.strokeOpacity = 1

      /**
       * @member {number} fillOpacity
       * WARNING: This API is experimental and may change.
       * The opacity of the glyph's fill from 0 to 1. This behaves like the material's `opacity` but allows
       * giving the fill a different opacity than the `strokeOpacity`. A fillOpacity of `0` makes the
       * interior of the glyph invisible, leaving just the `strokeWidth`. Defaults to `1`.
       */
      this.fillOpacity = 1

      /**
       * @member {number} depthOffset
       * This is a shortcut for setting the material's `polygonOffset` and related properties,
       * which can be useful in preventing z-fighting when this text is laid on top of another
       * plane in the scene. Positive numbers are further from the camera, negatives closer.
       */
      this.depthOffset = 0

      /**
       * @member {Array<number>} clipRect
       * If specified, defines a `[minX, minY, maxX, maxY]` of a rectangle outside of which all
       * pixels will be discarded. This can be used for example to clip overflowing text when
       * `whiteSpace='nowrap'`.
       */
      this.clipRect = null

      /**
       * @member {string} orientation
       * Defines the axis plane on which the text should be laid out when the mesh has no extra
       * rotation transform. It is specified as a string with two axes: the horizontal axis with
       * positive pointing right, and the vertical axis with positive pointing up. By default this
       * is '+x+y', meaning the text sits on the xy plane with the text's top toward positive y
       * and facing positive z. A value of '+x-z' would place it on the xz plane with the text's
       * top toward negative z and facing positive y.
       */
      this.orientation = defaultOrient

      /**
       * @member {number} glyphGeometryDetail
       * Controls number of vertical/horizontal segments that make up each glyph's rectangular
       * plane. Defaults to 1. This can be increased to provide more geometrical detail for custom
       * vertex shader effects, for example.
       */
      this.glyphGeometryDetail = 1

      /**
       * @member {number|null} sdfGlyphSize
       * The size of each glyph's SDF (signed distance field) used for rendering. This must be a
       * power-of-two number. Defaults to 64 which is generally a good balance of size and quality
       * for most fonts. Larger sizes can improve the quality of glyph rendering by increasing
       * the sharpness of corners and preventing loss of very thin lines, at the expense of
       * increased memory footprint and longer SDF generation time.
       */
      this.sdfGlyphSize = null

      this.debugSDF = false
    }

    /**
     * Updates the text rendering according to the current text-related configuration properties.
     * This is an async process, so you can pass in a callback function to be executed when it
     * finishes.
     * @param {function} [callback]
     */
    sync(callback) {
      if (this._needsSync) {
        this._needsSync = false

        /* detect text change coming from the component */
        if(this.prevText !== this.text){
          this.currentText = this.text
          this.selectionStartIndex = this.selectionEndIndex = -1
          this.prevText = this.text
        }
        
        this.currentText = this.currentText ? this.currentText : this.text

        // If there's another sync still in progress, queue
        if (this._isSyncing) {
          (this._queuedSyncs || (this._queuedSyncs = [])).push(callback)
        } else {
          this._isSyncing = true
          this.dispatchEvent(syncStartEvent)

          getTextRenderInfo({
            text: this.currentText,
            font: this.font,
            fontSize: this.fontSize || 0.1,
            letterSpacing: this.letterSpacing || 0,
            lineHeight: this.lineHeight || 'normal',
            maxWidth: this.maxWidth,
            textAlign: this.textAlign,
            textIndent: this.textIndent,
            whiteSpace: this.whiteSpace,
            overflowWrap: this.overflowWrap,
            anchorX: this.anchorX,
            anchorY: this.anchorY,
            colorRanges: this.colorRanges,
            includeCaretPositions: true, //TODO parameterize
            sdfGlyphSize: this.sdfGlyphSize
          }, textRenderInfo => {
            this._isSyncing = false

            // Save result for later use in onBeforeRender
            this._textRenderInfo = textRenderInfo

            // Update the geometry attributes
            this.geometry.updateGlyphs(
              textRenderInfo.glyphBounds,
              textRenderInfo.glyphAtlasIndices,
              textRenderInfo.blockBounds,
              textRenderInfo.chunkedBounds,
              textRenderInfo.glyphColors
            )

            // If we had extra sync requests queued up, kick it off
            const queued = this._queuedSyncs
            if (queued) {
              this._queuedSyncs = null
              this._needsSync = true
              this.sync(() => {
                queued.forEach(fn => fn && fn())
              })
            }

            //update dom with latest text
            if(this._domElText.textContent !== this.currentText){
              this._domElText.textContent = this.currentText;
            }

            this.dispatchEvent(syncCompleteEvent)
            if (callback) {
              callback()
            }
          })
        }
      }
    }

    onAfterRender(){
      if( this.supportScreenReader ){
        this.updateDomPosition()
      }
      if( this.selectable ){
        this.updateSelectedDomPosition()
      }
    }

    /**
     * Initiate a sync if needed - note it won't complete until next frame at the
     * earliest so if possible it's a good idea to call sync() manually as soon as
     * all the properties have been set.
     * @override
     */
    onBeforeRender(renderer, scene, camera, geometry, material, group) {
      this.camera = camera
      this.renderer = renderer
      this.sync()

      if( this.selectable ){
        this.updateHighlightTextUniforms()
      }

      // This may not always be a text material, e.g. if there's a scene.overrideMaterial present
      if (material.isTroikaTextMaterial) {
        this._prepareForRender(material)
      }
    }

    /**
     * Shortcut to dispose the geometry specific to this instance.
     * Note: we don't also dispose the derived material here because if anything else is
     * sharing the same base material it will result in a pause next frame as the program
     * is recompiled. Instead users can dispose the base material manually, like normal,
     * and we'll also dispose the derived material at that time.
     */
    dispose() {
      this.geometry.dispose()
    }

    /**
     * @property {TroikaTextRenderInfo|null} textRenderInfo
     * @readonly
     * The current processed rendering data for this TextMesh, returned by the TextBuilder after
     * a `sync()` call. This will be `null` initially, and may be stale for a short period until
     * the asynchrous `sync()` process completes.
     */
    get textRenderInfo() {
      return this._textRenderInfo || null
    }

    // Handler for automatically wrapping the base material with our upgrades. We do the wrapping
    // lazily on _read_ rather than write to avoid unnecessary wrapping on transient values.
    get material() {
      let derivedMaterial = this._derivedMaterial
      const baseMaterial = this._baseMaterial || this._defaultMaterial || (this._defaultMaterial = defaultMaterial.clone())
      if (!derivedMaterial || derivedMaterial.baseMaterial !== baseMaterial) {
        derivedMaterial = this._derivedMaterial = createTextDerivedMaterial(baseMaterial)
        // dispose the derived material when its base material is disposed:
        baseMaterial.addEventListener('dispose', function onDispose() {
          baseMaterial.removeEventListener('dispose', onDispose)
          derivedMaterial.dispose()
        })
      }
      // If text outline is configured, render it as a preliminary draw using Three's multi-material
      // feature (see GlyphsGeometry which sets up `groups` for this purpose) Doing it with multi
      // materials ensures the layers are always rendered consecutively in a consistent order.
      // Each layer will trigger onBeforeRender with the appropriate material.
      if (this.outlineWidth || this.outlineBlur || this.outlineOffsetX || this.outlineOffsetY) {
        let outlineMaterial = derivedMaterial._outlineMtl
        if (!outlineMaterial) {
          outlineMaterial = derivedMaterial._outlineMtl = Object.create(derivedMaterial, {
            id: {value: derivedMaterial.id + 0.1}
          })
          outlineMaterial.isTextOutlineMaterial = true
          outlineMaterial.depthWrite = false
          outlineMaterial.map = null //???
          derivedMaterial.addEventListener('dispose', function onDispose() {
            derivedMaterial.removeEventListener('dispose', onDispose)
            outlineMaterial.dispose()
          })
        }
        return [
          outlineMaterial,
          derivedMaterial
        ]
      } else {
        return derivedMaterial
      }
    }
    set material(baseMaterial) {
      if (baseMaterial && baseMaterial.isTroikaTextMaterial) { //prevent double-derivation
        this._derivedMaterial = baseMaterial
        this._baseMaterial = baseMaterial.baseMaterial
      } else {
        this._baseMaterial = baseMaterial
      }
    }

    get glyphGeometryDetail() {
      return this.geometry.detail
    }
    set glyphGeometryDetail(detail) {
      this.geometry.detail = detail
    }

    get curveRadius() {	
      return this.geometry.curveRadius	
    }	
    set curveRadius(r) {	
      this.geometry.curveRadius = r	
    }

    // Create and update material for shadows upon request:
    get customDepthMaterial() {
      return first(this.material).getDepthMaterial()
    }
    get customDistanceMaterial() {
      return first(this.material).getDistanceMaterial()
    }

    _prepareForRender(material) {
      const isOutline = material.isTextOutlineMaterial
      const uniforms = material.uniforms
      const textInfo = this.textRenderInfo
      if (textInfo) {
        const {sdfTexture, blockBounds} = textInfo
        uniforms.uTroikaSDFTexture.value = sdfTexture
        uniforms.uTroikaSDFTextureSize.value.set(sdfTexture.image.width, sdfTexture.image.height)
        uniforms.uTroikaSDFGlyphSize.value = textInfo.sdfGlyphSize
        uniforms.uTroikaSDFExponent.value = textInfo.sdfExponent
        uniforms.uTroikaTotalBounds.value.fromArray(blockBounds)
        uniforms.uTroikaUseGlyphColors.value = !isOutline && !!textInfo.glyphColors

        let distanceOffset = 0
        let blurRadius = 0
        let strokeWidth = 0
        let fillOpacity
        let strokeOpacity
        let strokeColor
        let offsetX = 0
        let offsetY = 0

        if (isOutline) {
          let {outlineWidth, outlineOffsetX, outlineOffsetY, outlineBlur, outlineOpacity} = this
          distanceOffset = this._parsePercent(outlineWidth) || 0
          blurRadius = Math.max(0, this._parsePercent(outlineBlur) || 0)
          fillOpacity = outlineOpacity
          offsetX = this._parsePercent(outlineOffsetX) || 0
          offsetY = this._parsePercent(outlineOffsetY) || 0
        } else {
          strokeWidth = Math.max(0, this._parsePercent(this.strokeWidth) || 0)
          if (strokeWidth) {
            strokeColor = this.strokeColor
            uniforms.uTroikaStrokeColor.value.set(strokeColor == null ? defaultStrokeColor : strokeColor)
            strokeOpacity = this.strokeOpacity
            if (strokeOpacity == null) strokeOpacity = 1
          }
          fillOpacity = this.fillOpacity
        }

        uniforms.uTroikaDistanceOffset.value = distanceOffset
        uniforms.uTroikaPositionOffset.value.set(offsetX, offsetY)
        uniforms.uTroikaBlurRadius.value = blurRadius
        uniforms.uTroikaStrokeWidth.value = strokeWidth
        uniforms.uTroikaStrokeOpacity.value = strokeOpacity
        uniforms.uTroikaFillOpacity.value = fillOpacity == null ? 1 : fillOpacity
        uniforms.uTroikaCurveRadius.value = this.curveRadius || 0

        let clipRect = this.clipRect
        if (clipRect && Array.isArray(clipRect) && clipRect.length === 4) {
          uniforms.uTroikaClipRect.value.fromArray(clipRect)
        } else {
          // no clipping - choose a finite rect that shouldn't ever be reached by overflowing glyphs or outlines
          const pad = (this.fontSize || 0.1) * 100
          uniforms.uTroikaClipRect.value.set(
            blockBounds[0] - pad,
            blockBounds[1] - pad,
            blockBounds[2] + pad,
            blockBounds[3] + pad
          )
        }
        this.geometry.applyClipRect(uniforms.uTroikaClipRect.value)
      }
      uniforms.uTroikaSDFDebug.value = !!this.debugSDF
      material.polygonOffset = !!this.depthOffset
      material.polygonOffsetFactor = material.polygonOffsetUnits = this.depthOffset || 0

      // Shortcut for setting material color via `color` prop on the mesh; this is
      // applied only to the derived material to avoid mutating a shared base material.
      const color = isOutline ? (this.outlineColor || 0) : this.color

      if (color == null) {
        delete material.color //inherit from base
      } else {
        const colorObj = material.hasOwnProperty('color') ? material.color : (material.color = new Color())
        if (color !== colorObj._input || typeof color === 'object') {
          colorObj.set(colorObj._input = color)
        }
      }

      // base orientation
      let orient = this.orientation || defaultOrient
      if (orient !== material._orientation) {
        let rotMat = uniforms.uTroikaOrient.value
        orient = orient.replace(/[^-+xyz]/g, '')
        let match = orient !== defaultOrient && orient.match(/^([-+])([xyz])([-+])([xyz])$/)
        if (match) {
          let [, hSign, hAxis, vSign, vAxis] = match
          tempVec3a.set(0, 0, 0)[hAxis] = hSign === '-' ? 1 : -1
          tempVec3b.set(0, 0, 0)[vAxis] = vSign === '-' ? -1 : 1
          tempMat4.lookAt(origin, tempVec3a.cross(tempVec3b), tempVec3b)
          rotMat.setFromMatrix4(tempMat4)
        } else {
          rotMat.identity()
        }
        material._orientation = orient
      }
    }

    _parsePercent(value) {
      if (typeof value === 'string') {
        let match = value.match(/^(-?[\d.]+)%$/)
        let pct = match ? parseFloat(match[1]) : NaN
        value = (isNaN(pct) ? 0 : pct / 100) * this.fontSize
      }
      return value
    }

    /**
     * Translate a point in local space to an x/y in the text plane.
     */
    localPositionToTextCoords(position, target = new Vector2()) {
      target.copy(position) //simple non-curved case is 1:1
      const r = this.curveRadius
      if (r) { //flatten the curve
        target.x = Math.atan2(position.x, Math.abs(r) - Math.abs(position.z)) * Math.abs(r)
      }
      return target
    }

    /**
     * Translate a point in world space to an x/y in the text plane.
     */
    worldPositionToTextCoords(position, target = new Vector2()) {
      tempVec3a.copy(position)
      return this.localPositionToTextCoords(this.worldToLocal(tempVec3a), target)
    }

    /**
     * Given a local x/y coordinate in the text block plane, set the start position of the caret 
     * used in text selection 
     * @param {number} x
     * @param {number} y
     * @return {TextCaret | null}
     */
    startCaret(x,y){
      let caret = getCaretAtPoint(this.textRenderInfo, x, y)
      this.selectionStartIndex = caret.charIndex
      this.selectionEndIndex = caret.charIndex
      this.updateSelection()
      return caret
    }

    /**
     * Given a local x/y coordinate in the text block plane, set the end position of the caret 
     * used in text selection 
     * @param {number} x
     * @param {number} y
     * @return {TextCaret | null}
     */
    moveCaret(x,y){
      let caret = getCaretAtPoint(this.textRenderInfo, x, y)
      this.selectionEndIndex = caret.charIndex
      this.updateSelection()
      return caret
    }

    /**
     * update the selection visually and everything related to copy /paste
     */
    updateSelection() {
      if(this.selectable){
        this.selectedText = this.text.substring(this.selectionStartIndex,this.selectionEndIndex)
        this.selectionRects = getSelectionRects(this._textRenderInfo,this.selectionStartIndex,this.selectionEndIndex)
        this._domElSelectedText.textContent = this.selectedText
        this.selectDomText()
        this.updateSelectedDomPosition()
      }else{
        this.selectedText = null
        this.selectionRects = []
      }
    }

    /**
     * Select the text contened in _domElSelectedText in order for it to reflect what's currently selected in the Text
     */
    selectDomText(){
      this.highlightText()
        const sel = document.getSelection()
        sel.removeAllRanges()
        const range = document.createRange()
        range.selectNodeContents(this._domElSelectedText); //sets Range
        sel.removeAllRanges(); //remove all ranges from selection
        sel.addRange(range);
    }

    /**
     * update the position of the overlaying HTML that contain all the text that need to be accessible to screen readers
     */
    updateDomPosition(){
      let bbox = this.renderer.domElement.getBoundingClientRect()
      let width = bbox.width
      let height = bbox.height
      let left = bbox.left
      let top = bbox.top
      var widthHalf = width / 2, heightHalf = height / 2;

      var max  = new Vector3(0,0,0);
      var min  = new Vector3(0,0,0);

      this.geometry.computeBoundingBox()
      max.copy(this.geometry.boundingBox.max).applyMatrix4( this.matrixWorld );
      min.copy(this.geometry.boundingBox.min).applyMatrix4( this.matrixWorld );

      var bboxVectors = 
      [
        new Vector3(max.x,max.y,max.z),
        new Vector3(min.x,max.y,max.z),
        new Vector3(min.x,min.y,max.z),
        new Vector3(max.x,min.y,max.z),
        new Vector3(max.x,max.y,min.z),
        new Vector3(min.x,max.y,min.z),
        new Vector3(min.x,min.y,min.z),
        new Vector3(max.x,min.y,min.z)
      ]

      let xmin = null
      let xmax = null
      let ymin = null
      let ymax = null


      bboxVectors.forEach(vec => {
        vec.project(this.camera);
      });
      xmin = bboxVectors[0].x
      xmax = bboxVectors[0].x
      ymin = bboxVectors[0].y
      ymax = bboxVectors[0].y
      bboxVectors.forEach(vec => {
        xmin = xmin > vec.x ? vec.x : xmin
        xmax = xmax < vec.x ? vec.x : xmax
        ymin = ymin > vec.y ? vec.y : ymin
        ymax = ymax < vec.y ? vec.y : ymax
      });

      xmax = ( xmax * widthHalf ) + widthHalf;
      ymax = - ( ymax * heightHalf ) + heightHalf;
      xmin = ( xmin * widthHalf ) + widthHalf;
      ymin = - ( ymin * heightHalf ) + heightHalf;

      this._domElText.style.left = xmin+left+'px';
      this._domElText.style.top = ymax+top+'px';
      this._domElText.style.width = Math.abs(xmax-xmin)+'px';
      this._domElText.style.height = Math.abs(ymax-ymin)+'px';
      this._domElText.style.fontSize = Math.abs(ymax-ymin)+'px';
    }

    /**
     * update the position of the overlaying HTML that contain
     * the selected text in order for it to be acessible through context menu copy
     */
    updateSelectedDomPosition(){
      if(this.children.length === 0){
        this._domElSelectedText.style.width = '0px';
        this._domElSelectedText.style.height = '0px';
        return
      }
      
      let bbox = this.renderer.domElement.getBoundingClientRect()
      let width = bbox.width
      let height = bbox.height
      let left = bbox.left
      let top = bbox.top
      var widthHalf = width / 2, heightHalf = height / 2;

      var max  = new Vector3(0,0,0);
      var min  = new Vector3(0,0,0);


      this.children[0].geometry.computeBoundingBox()
      this.children[this.children.length-1].geometry.computeBoundingBox()

      // max.copy(this.children[0].geometry.boundingBox.max)
      // min.copy(this.children[0].geometry.boundingBox.min)
      // max.max(this.children[this.children.length-1].geometry.boundingBox.max).applyMatrix4( this.children[this.children.length-1].matrixWorld );
      // min.min(this.children[this.children.length-1].geometry.boundingBox.min).applyMatrix4( this.children[this.children.length-1].matrixWorld );

      let i=0;
      for (let key in this.selectionRects) {
        if(i===0){
          max.x  = Math.max(this.selectionRects[key].left,this.selectionRects[key].right);
          max.y  = Math.max(this.selectionRects[key].top,this.selectionRects[key].bottom);
          max.z  = this.geometry.boundingBox.max.z;
          min.x  = Math.min(this.selectionRects[key].left,this.selectionRects[key].right);
          min.y  = Math.min(this.selectionRects[key].top,this.selectionRects[key].bottom);
          min.z  = this.geometry.boundingBox.min.z;
        }else{
          max.x  = Math.max(max.x,this.selectionRects[key].left,this.selectionRects[key].right);
          max.y  = Math.max(max.y,this.selectionRects[key].top,this.selectionRects[key].bottom);
          min.x  = Math.min(min.x,this.selectionRects[key].left,this.selectionRects[key].right);
          min.y  = Math.min(min.y,this.selectionRects[key].top,this.selectionRects[key].bottom);
        }
        i++;
      }

      var bboxVectors = 
      [
        new Vector3(max.x,max.y,max.z).applyMatrix4( this.matrixWorld ),
        new Vector3(min.x,max.y,max.z).applyMatrix4( this.matrixWorld ),
        new Vector3(min.x,min.y,max.z).applyMatrix4( this.matrixWorld ),
        new Vector3(max.x,min.y,max.z).applyMatrix4( this.matrixWorld ),
        new Vector3(max.x,max.y,min.z).applyMatrix4( this.matrixWorld ),
        new Vector3(min.x,max.y,min.z).applyMatrix4( this.matrixWorld ),
        new Vector3(min.x,min.y,min.z).applyMatrix4( this.matrixWorld ),
        new Vector3(max.x,min.y,min.z).applyMatrix4( this.matrixWorld )
      ]

      let xmin = null
      let xmax = null
      let ymin = null
      let ymax = null

      bboxVectors.forEach(vec => {
        vec.project(this.camera);
      });
      xmin = bboxVectors[0].x
      xmax = bboxVectors[0].x
      ymin = bboxVectors[0].y
      ymax = bboxVectors[0].y
      bboxVectors.forEach(vec => {
        xmin = xmin > vec.x ? vec.x : xmin
        xmax = xmax < vec.x ? vec.x : xmax
        ymin = ymin > vec.y ? vec.y : ymin
        ymax = ymax < vec.y ? vec.y : ymax
      });

      xmax = ( xmax * widthHalf ) + widthHalf;
      ymax = - ( ymax * heightHalf ) + heightHalf;
      xmin = ( xmin * widthHalf ) + widthHalf;
      ymin = - ( ymin * heightHalf ) + heightHalf;

      this._domElSelectedText.style.left = xmin+left+'px';
      this._domElSelectedText.style.top = ymax+top+'px';
      this._domElSelectedText.style.width = Math.abs(xmax-xmin)+'px';
      this._domElSelectedText.style.height = Math.abs(ymax-ymin)+'px';
    }

    /**
     * visually update the rendering of the text selection in the renderer context
     */
    highlightText() {

      let THICKNESS = 0.25;

      //todo manage rect update in a cleaner way. Currently we recreate everything everytime
      this.children = []

      for (let key in this.selectionRects) {
        let material = createDerivedMaterial(
        this.selectionMaterial ? this.selectionMaterial : new MeshBasicMaterial({
          color:this.selectionColor ? this.selectionColor : defaultSelectionColor,
          transparent: true,
          opacity: 0.3,
          depthWrite: false
        }),
        {
          uniforms: {
            rect: {value: new Vector4(
              this.selectionRects[key].left ,
              this.selectionRects[key].top ,
              this.selectionRects[key].right ,
              this.selectionRects[key].bottom 
            )},
            depthAndCurveRadius: {value: new Vector2(
              (this.selectionRects[key].top - this.selectionRects[key].bottom)*THICKNESS,
              this.curveRadius
            )}
          },
            vertexDefs: `
            uniform vec4 rect;
            uniform vec2 depthAndCurveRadius;
            `,
            vertexTransform: `
            float depth = depthAndCurveRadius.x;
            float rad = depthAndCurveRadius.y;
            position.x = mix(rect.x, rect.z, position.x);
            position.y = mix(rect.w, rect.y, position.y);
            position.z = mix(-depth * 0.5, depth * 0.5, position.z);
            if (rad != 0.0) {
              float angle = position.x / rad;
              position.xz = vec2(sin(angle) * (rad - position.z), rad - cos(angle) * (rad - position.z));
              // TODO fix normals: normal.xz = vec2(sin(angle), cos(angle));
            }
            `
          }
        )
        material.instanceUniforms = ['rect', 'depthAndCurveRadius', 'diffuse']
        let selectRect = new Mesh(
          new BoxBufferGeometry(1, 1, 0.1, 32).translate(0.5, 0.5, 0.5),
          material
          // new MeshBasicMaterial({color: 0xffffff,side: DoubleSide,transparent: true, opacity:0.5})
        )
        // selectRect.position.x = -1
        // selectRect.position.y = -1
        this.add(selectRect)        
      }
      this.updateWorldMatrix(false,true)
    }

    updateHighlightTextUniforms(){
      for (let key in this.selectionRects) {
        this.children[key].material.uniforms.depthAndCurveRadius.value.y = this.curveRadius
        this.children[key].material.uniforms.rect.value.x = this.selectionRects[key].left
        this.children[key].material.uniforms.rect.value.y = this.selectionRects[key].top
        this.children[key].material.uniforms.rect.value.z = this.selectionRects[key].right
        this.children[key].material.uniforms.rect.value.w = this.selectionRects[key].bottom
        if(this.selectionColor != this.children[key].material.color){
          //faster to check fo color change or to set needsUpdate true each time ? 
          //to discuss
          this.children[key].material.color.set(this.selectionColor)
          this.children[key].material.needsUpdate = true
        }
      }
    }

    /**
     * Start watching change on the overlaying HTML such as browser dom translation in order to reflect it in the renderer context
     */
    startObservingMutation(){
      //todo right now each Text class has its own MutationObserver, maybe it cn cause issues if used with multiple Text
      this.observer = new MutationObserver(this.mutationCallback.bind(this));
      // Start observing the target node for change ( e.g. page translate )
      this.observer.observe(this._domElText, { attributes: false, childList: true, subtree: false });
    }

    /**
     * When a change occurs on the overlaying HTML, it reflect it in the renderer context
     */
    mutationCallback(mutationsList, observer) {
      if(this._domElText.textContent != this.currentText){
        this.currentText = this._domElText.textContent
        console.log(this.currentText)
        this._needsSync = true;
        this.sync(()=>{
          this.selectedText != '' ? this.updateSelection() : null
        })
      }
    }
    
    /**
     * stop monitoring dom change
     */
    stopObservingMutation(){
      this.observer.disconnect();
    }

    /**
     * @override Custom raycasting to test against the whole text block's max rectangular bounds
     * TODO is there any reason to make this more granular, like within individual line or glyph rects?
     */
    raycast(raycaster, intersects) {
      const {textRenderInfo, curveRadius} = this
      if (textRenderInfo) {
        const bounds = textRenderInfo.blockBounds
        const raycastMesh = curveRadius ? getCurvedRaycastMesh() : getFlatRaycastMesh()
        const geom = raycastMesh.geometry
        const {position, uv} = geom.attributes
        for (let i = 0; i < uv.count; i++) {
          let x = bounds[0] + (uv.getX(i) * (bounds[2] - bounds[0]))
          const y = bounds[1] + (uv.getY(i) * (bounds[3] - bounds[1]))
          let z = 0
          if (curveRadius) {
            z = curveRadius - Math.cos(x / curveRadius) * curveRadius
            x = Math.sin(x / curveRadius) * curveRadius
          }
          position.setXYZ(i, x, y, z)
        }
        geom.boundingSphere = this.geometry.boundingSphere
        geom.boundingBox = this.geometry.boundingBox
        raycastMesh.matrixWorld = this.matrixWorld
        raycastMesh.material.side = this.material.side
        tempArray.length = 0
        raycastMesh.raycast(raycaster, tempArray)
        for (let i = 0; i < tempArray.length; i++) {
          tempArray[i].object = this
          intersects.push(tempArray[i])
        }
      }
    }

    copy(source) {
      // Prevent copying the geometry reference so we don't end up sharing attributes between instances
      const geom = this.geometry
      super.copy(source)
      this.geometry = geom

      COPYABLE_PROPS.forEach(prop => {
        this[prop] = source[prop]
      })
      return this
    }

    clone() {
      return new this.constructor().copy(this)
    }
  }



  // Create setters for properties that affect text layout:
  SYNCABLE_PROPS.forEach(prop => {
    const privateKey = '_private_' + prop
    Object.defineProperty(Text.prototype, prop, {
      get() {
        return this[privateKey]
      },
      set(value) {
        if (value !== this[privateKey]) {
          this[privateKey] = value
          this._needsSync = true
        }
      }
    })
  })


  // Deprecation handler for `anchor` array:
  let deprMsgShown = false
  Object.defineProperty(Text.prototype, 'anchor', {
    get() {
      return this._deprecated_anchor
    },
    set(val) {
      this._deprecated_anchor = val
      if (!deprMsgShown) {
        console.warn('TextMesh: `anchor` has been deprecated; use `anchorX` and `anchorY` instead.')
        deprMsgShown = true
      }
      if (Array.isArray(val)) {
        this.anchorX = `${(+val[0] || 0) * 100}%`
        this.anchorY = `${(+val[1] || 0) * 100}%`
      } else {
        this.anchorX = this.anchorY = 0
      }
    }
  })

  return Text
})()

export {
  Text
}
