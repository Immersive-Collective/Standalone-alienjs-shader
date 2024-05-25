import {
    BloomCompositeMaterial, 
    Color, 
    ColorManagement, 
    DirectionalLight, 
    Fluid, 
    Fog, 
    GLSL3, 
    Group, 
    HemisphereLight, 
    LinearSRGBColorSpace, 
    LuminosityMaterial, 
    MathUtils, 
    Mesh, 
    MeshBasicMaterial, 
    MeshStandardMaterial, 
    NoBlending, 
    OrthographicCamera, 
    PanelItem, 
    PerspectiveCamera, 
    PlaneGeometry, 
    RawShaderMaterial, 
    Reflector, 
    RepeatWrapping, 
    Scene, 
    TextureLoader, 
    UI, 
    UnrealBloomBlurMaterial, 
    Vector2, 
    Vector3, 
    WebGLRenderTarget, 
    WebGLRenderer, 
    getFullscreenTriangle, 
    ticker
} from '@alienkitty/alien.js/src/all.three.js';

import rgbshift from '@alienkitty/alien.js/src/shaders/modules/rgbshift/rgbshift.glsl.js';
import { SVGLoader } from '@alienkitty/alien.js/src/all.three.js';
import { GLTFLoader } from '@alienkitty/alien.js/src/all.three.js';

class CompositeMaterial extends RawShaderMaterial {
    constructor() {
        super({
            glslVersion: GLSL3,
            uniforms: {
                tScene: { value: null },
                tBloom: { value: null },
                tFluid: { value: null },
                uBloomDistortion: { value: 1.5 }
            },
            vertexShader: /* glsl */ `
                in vec3 position;
                in vec2 uv;

                out vec2 vUv;

                void main() {
                    vUv = uv;

                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;

                uniform sampler2D tScene;
                uniform sampler2D tBloom;
                uniform sampler2D tFluid;
                uniform float uBloomDistortion;

                in vec2 vUv;

                out vec4 FragColor;

                ${rgbshift}

                void main() {
                    vec3 fluid = texture(tFluid, vUv).rgb;
                    vec2 uv = vUv - fluid.rg * 0.0002;

                    vec2 dir = 0.5 - vUv;
                    float angle = atan(dir.y, dir.x);
                    float amount = length(fluid.rg) * 0.0001;

                    FragColor = getRGB(tScene, uv, angle, amount);

                    FragColor.rgb += getRGB(tBloom, uv, angle, amount + 0.001 * uBloomDistortion).rgb;
                }
            `,
            blending: NoBlending,
            depthTest: false,
            depthWrite: false
        });
    }
}

class Triangle extends Group {
    constructor() {
        super();
    }

    async initMesh() {
        const { camera, loadSVG } = WorldController;

        const data = await loadSVG('data:image/svg+xml;utf8,<svg><path d="M 3 0 L 0 5 H 6 Z" stroke-width="0.25"/></svg>');
        const paths = data.paths;

        const group = new Group();
        group.position.set(0, 1.4, -11);
        group.scale.y *= -1;
        group.lookAt(camera.position);

        for (let i = 0, l = paths.length; i < l; i++) {
            const path = paths[i];

            const material = new MeshBasicMaterial();

            for (let j = 0, jl = path.subPaths.length; j < jl; j++) {
                const subPath = path.subPaths[j];
                const geometry = SVGLoader.pointsToStroke(subPath.getPoints(), path.userData.style);

                if (geometry) {
                    geometry.center();

                    const mesh = new Mesh(geometry, material);
                    group.add(mesh);
                }
            }
        }

        this.add(group);
    }
}

class Floor extends Group {
    constructor() {
        super();

        this.initReflector();
    }

    initReflector() {
        this.reflector = new Reflector();
    }

    async initMesh() {
        const { loadTexture } = WorldController;
    
        const geometry = new PlaneGeometry(100, 100);
    
        // Second set of UVs for aoMap and lightMap
        geometry.attributes.uv1 = geometry.attributes.uv;
    
        // Textures
        let map, normalMap, ormMap;
        try {
            [map, normalMap, ormMap] = await Promise.all([
                loadTexture('textures/pbr/polished_concrete_basecolor.jpg'),
                loadTexture('textures/pbr/polished_concrete_normal.jpg'),
                loadTexture('textures/pbr/polished_concrete_orm.jpg')
            ]);
    
            console.log('Textures loaded:', map, normalMap, ormMap);
    
            if (!map || !normalMap || !ormMap) {
                throw new Error('One or more textures failed to load');
            }
    
            map.wrapS = RepeatWrapping;
            map.wrapT = RepeatWrapping;
            map.repeat.set(16, 16);
    
            normalMap.wrapS = RepeatWrapping;
            normalMap.wrapT = RepeatWrapping;
            normalMap.repeat.set(16, 16);
    
            ormMap.wrapS = RepeatWrapping;
            ormMap.wrapT = RepeatWrapping;
            ormMap.repeat.set(16, 16);
    
        } catch (error) {
            console.error('Error loading textures:', error);
            return; // Exit the function if textures are not loaded
        }
    
        const material = new MeshStandardMaterial({
            color: new Color().offsetHSL(0, 0, -0.65),
            metalness: 1,
            roughness: 1,
            map,
            metalnessMap: ormMap,
            roughnessMap: ormMap,
            aoMap: ormMap,
            aoMapIntensity: 1,
            normalMap,
            normalScale: new Vector2(3, 3)
        });
    
        // Second channel for aoMap and lightMap
        material.aoMap.channel = 1;
    
        const uniforms = {
            mirror: { value: 0 },
            mixStrength: { value: 10 }
        };
    
        material.onBeforeCompile = shader => {
            shader.uniforms.reflectMap = this.reflector.renderTargetUniform;
            shader.uniforms.textureMatrix = this.reflector.textureMatrixUniform;
    
            shader.uniforms = Object.assign(shader.uniforms, uniforms);
    
            shader.vertexShader = shader.vertexShader.replace(
                'void main() {',
                /* glsl */ `
                uniform mat4 textureMatrix;
                out vec4 vCoord;
                out vec3 vToEye;
    
                void main() {
                `
            );
    
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
    
                vCoord = textureMatrix * vec4(transformed, 1.0);
                vToEye = cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz;
                `
            );
    
            shader.fragmentShader = shader.fragmentShader.replace(
                'void main() {',
                /* glsl */ `
                uniform sampler2D reflectMap;
                uniform float mirror;
                uniform float mixStrength;
                in vec4 vCoord;
                in vec3 vToEye;
    
                void main() {
                `
            );
    
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <emissivemap_fragment>',
                /* glsl */ `
                #include <emissivemap_fragment>
    
                vec4 normalColor = texture(normalMap, vNormalMapUv * normalScale);
                vec3 reflectNormal = normalize(vec3(normalColor.r * 2.0 - 1.0, normalColor.b, normalColor.g * 2.0 - 1.0));
                vec3 reflectCoord = vCoord.xyz / vCoord.w;
                vec2 reflectUv = reflectCoord.xy + reflectCoord.z * reflectNormal.xz * 0.05;
                vec4 reflectColor = texture(reflectMap, reflectUv);
    
                // Fresnel term
                vec3 toEye = normalize(vToEye);
                float theta = max(dot(toEye, normal), 0.0);
                float reflectance = pow((1.0 - theta), 5.0);
    
                reflectColor = mix(vec4(0), reflectColor, reflectance);
    
                diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + reflectColor.rgb * mixStrength);
                `
            );
        };
    
        const mesh = new Mesh(geometry, material);
        mesh.position.y = -1.6;
        mesh.rotation.x = -Math.PI / 2;
        mesh.add(this.reflector);
    
        mesh.onBeforeRender = (renderer, scene, camera) => {
            this.visible = false;
            this.reflector.update(renderer, scene, camera);
            this.visible = true;
        };
    
        this.add(mesh);
    }
        

    // Public methods

    resize = (width, height) => {
        width = MathUtils.floorPowerOfTwo(width) / 2;
        height = 1024;

        this.reflector.setSize(width, height);
    };
}

class SceneView extends Group {
    constructor() {
        super();

        this.visible = false;

        this.initViews();
    }

    initViews() {
        this.floor = new Floor();
        this.add(this.floor);

        this.triangle = new Triangle();
        this.add(this.triangle);
    }

    // Public methods

    resize = (width, height) => {
        this.floor.resize(width, height);
    };

    ready = () => Promise.all([
        this.floor.initMesh(),
        this.triangle.initMesh()
    ]);
}

class SceneController {
    static init(view) {
        this.view = view;
    }

    // Public methods

    static resize = (width, height) => {
        this.view.resize(width, height);
    };

    static update = () => {
    };

    static animateIn = () => {
        this.view.visible = true;
    };

    static ready = () => this.view.ready();
}

class PanelController {
    static init(ui) {
        console.log("Initializing PanelController..."); // Debugging line
        this.ui = ui;

        this.initPanel();
    }

    static initPanel() {
        const { fluid, luminosityMaterial, bloomCompositeMaterial, compositeMaterial } = RenderManager;

        const items = [
            { name: 'FPS' },
            { type: 'divider' },
            {
                type: 'slider',
                name: 'Iterate',
                min: 0,
                max: 10,
                step: 1,
                value: fluid.iterations,
                callback: value => { fluid.iterations = value; }
            },
            {
                type: 'slider',
                name: 'Density',
                min: 0,
                max: 1,
                step: 0.01,
                value: fluid.densityDissipation,
                callback: value => { fluid.densityDissipation = value; }
            },
            {
                type: 'slider',
                name: 'Velocity',
                min: 0,
                max: 1,
                step: 0.01,
                value: fluid.velocityDissipation,
                callback: value => { fluid.velocityDissipation = value; }
            },
            {
                type: 'slider',
                name: 'Pressure',
                min: 0,
                max: 1,
                step: 0.01,
                value: fluid.pressureDissipation,
                callback: value => { fluid.pressureDissipation = value; }
            },
            {
                type: 'slider',
                name: 'Curl',
                min: 0,
                max: 50,
                step: 0.1,
                value: fluid.curlStrength,
                callback: value => { fluid.curlStrength = value; }
            },
            {
                type: 'slider',
                name: 'Radius',
                min: 0,
                max: 1,
                step: 0.01,
                value: fluid.radius,
                callback: value => { fluid.radius = value; }
            },
            { type: 'divider' },
            {
                type: 'slider',
                name: 'Thresh',
                min: 0,
                max: 1,
                step: 0.01,
                value: luminosityMaterial.uniforms.uThreshold.value,
                callback: value => { luminosityMaterial.uniforms.uThreshold.value = value; }
            },
            {
                type: 'slider',
                name: 'Smooth',
                min: 0,
                max: 1,
                step: 0.01,
                value: luminosityMaterial.uniforms.uSmoothing.value,
                callback: value => { luminosityMaterial.uniforms.uSmoothing.value = value; }
            },
            {
                type: 'slider',
                name: 'Strength',
                min: 0,
                max: 2,
                step: 0.01,
                value: RenderManager.bloomStrength,
                callback: value => {
                    RenderManager.bloomStrength = value;
                    bloomCompositeMaterial.uniforms.uBloomFactors.value = RenderManager.bloomFactors();
                }
            },
            {
                type: 'slider',
                name: 'Radius',
                min: 0,
                max: 1,
                step: 0.01,
                value: RenderManager.bloomRadius,
                callback: value => {
                    RenderManager.bloomRadius = value;
                    bloomCompositeMaterial.uniforms.uBloomFactors.value = RenderManager.bloomFactors();
                }
            },
            {
                type: 'slider',
                name: 'Chroma',
                min: 0,
                max: 10,
                step: 0.1,
                value: compositeMaterial.uniforms.uBloomDistortion.value,
                callback: value => { compositeMaterial.uniforms.uBloomDistortion.value = value; }
            }
        ];

        console.log("Adding panel items..."); // Debugging line
        items.forEach(data => {
            this.ui.addPanel(new PanelItem(data));
        });
    }
}


const BlurDirectionX = new Vector2(1, 0);
const BlurDirectionY = new Vector2(0, 1);

class RenderManager {
    static init(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.width = 1;
        this.height = 1;

        // Fluid simulation
        this.lastMouse = new Vector2();

        // Bloom
        this.luminosityThreshold = 0.1;
        this.luminositySmoothing = 1;
        this.bloomStrength = 0.3;
        this.bloomRadius = 0.2;
        this.bloomDistortion = 1.5;

        this.enabled = true;

        this.initRenderer();

        this.addListeners();
    }

    static initRenderer() {
        const { screenTriangle, aspect } = WorldController;

        // Fullscreen triangle
        this.screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.screen = new Mesh(screenTriangle);
        this.screen.frustumCulled = false;

        // Render targets
        this.renderTarget = new WebGLRenderTarget(1, 1, {
            depthBuffer: false
        });

        this.renderTargetsHorizontal = [];
        this.renderTargetsVertical = [];
        this.nMips = 5;

        this.renderTargetBright = this.renderTarget.clone();

        for (let i = 0, l = this.nMips; i < l; i++) {
            this.renderTargetsHorizontal.push(this.renderTarget.clone());
            this.renderTargetsVertical.push(this.renderTarget.clone());
        }

        this.renderTarget.depthBuffer = true;

        // Fluid simulation
        this.fluid = new Fluid(this.renderer, {
            curlStrength: 0
        });
        this.fluid.splatMaterial.uniforms.uAspect = aspect;

        // Luminosity high pass material
        this.luminosityMaterial = new LuminosityMaterial();
        this.luminosityMaterial.uniforms.uThreshold.value = this.luminosityThreshold;
        this.luminosityMaterial.uniforms.uSmoothing.value = this.luminositySmoothing;

        // Separable Gaussian blur materials
        this.blurMaterials = [];

        const kernelSizeArray = [3, 5, 7, 9, 11];

        for (let i = 0, l = this.nMips; i < l; i++) {
            this.blurMaterials.push(new UnrealBloomBlurMaterial(kernelSizeArray[i]));
        }

        // Bloom composite material
        this.bloomCompositeMaterial = new BloomCompositeMaterial();
        this.bloomCompositeMaterial.uniforms.tBlur1.value = this.renderTargetsVertical[0].texture;
        this.bloomCompositeMaterial.uniforms.tBlur2.value = this.renderTargetsVertical[1].texture;
        this.bloomCompositeMaterial.uniforms.tBlur3.value = this.renderTargetsVertical[2].texture;
        this.bloomCompositeMaterial.uniforms.tBlur4.value = this.renderTargetsVertical[3].texture;
        this.bloomCompositeMaterial.uniforms.tBlur5.value = this.renderTargetsVertical[4].texture;
        this.bloomCompositeMaterial.uniforms.uBloomFactors.value = this.bloomFactors();

        // Composite material
        this.compositeMaterial = new CompositeMaterial();
        this.compositeMaterial.uniforms.tFluid = this.fluid.uniform;
        this.compositeMaterial.uniforms.uBloomDistortion.value = this.bloomDistortion;
    }

    static bloomFactors() {
        const bloomFactors = [1, 0.8, 0.6, 0.4, 0.2];

        for (let i = 0, l = this.nMips; i < l; i++) {
            const factor = bloomFactors[i];
            bloomFactors[i] = this.bloomStrength * MathUtils.lerp(factor, 1.2 - factor, this.bloomRadius);
        }

        return bloomFactors;
    }

    static addListeners() {
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
    }

    // Event handlers

    static onPointerDown = e => {
        this.onPointerMove(e);
    };

    static onPointerMove = ({ clientX, clientY }) => {
        if (!this.enabled) {
            return;
        }

        const event = {
            x: clientX,
            y: clientY
        };

        // First input
        if (!this.lastMouse.isInit) {
            this.lastMouse.isInit = true;
            this.lastMouse.copy(event);
        }

        const deltaX = event.x - this.lastMouse.x;
        const deltaY = event.y - this.lastMouse.y;

        this.lastMouse.copy(event);

        // Add if the mouse is moving
        if (Math.abs(deltaX) || Math.abs(deltaY)) {
            // Update fluid simulation inputs
            this.fluid.splats.push({
                // Get mouse value in 0 to 1 range, with Y flipped
                x: event.x / this.width,
                y: 1 - event.y / this.height,
                dx: deltaX * 5,
                dy: deltaY * -5
            });
        }
    };

    static onPointerUp = e => {
        this.onPointerMove(e);
    };

    // Public methods

    static resize = (width, height, dpr) => {
        this.width = width;
        this.height = height;

        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(width, height);

        width = Math.round(width * dpr);
        height = Math.round(height * dpr);

        this.renderTarget.setSize(width, height);

        // Unreal bloom
        width = MathUtils.floorPowerOfTwo(width) / 2;
        height = MathUtils.floorPowerOfTwo(height) / 2;

        this.renderTargetBright.setSize(width, height);

        for (let i = 0, l = this.nMips; i < l; i++) {
            this.renderTargetsHorizontal[i].setSize(width, height);
            this.renderTargetsVertical[i].setSize(width, height);

            this.blurMaterials[i].uniforms.uResolution.value.set(width, height);

            width /= 2;
            height /= 2;
        }
    };

    static update = () => {
        const renderer = this.renderer;
        const scene = this.scene;
        const camera = this.camera;

        if (!this.enabled) {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            return;
        }

        const renderTarget = this.renderTarget;
        const renderTargetBright = this.renderTargetBright;
        const renderTargetsHorizontal = this.renderTargetsHorizontal;
        const renderTargetsVertical = this.renderTargetsVertical;

        // Perform all of the fluid simulation renders
        this.fluid.update();

        // Scene pass
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);

        // Extract bright areas
        this.luminosityMaterial.uniforms.tMap.value = renderTarget.texture;
        this.screen.material = this.luminosityMaterial;
        renderer.setRenderTarget(renderTargetBright);
        renderer.render(this.screen, this.screenCamera);

        // Blur all the mips progressively
        let inputRenderTarget = renderTargetBright;

        for (let i = 0, l = this.nMips; i < l; i++) {
            this.screen.material = this.blurMaterials[i];

            this.blurMaterials[i].uniforms.tMap.value = inputRenderTarget.texture;
            this.blurMaterials[i].uniforms.uDirection.value = BlurDirectionX;
            renderer.setRenderTarget(renderTargetsHorizontal[i]);
            renderer.render(this.screen, this.screenCamera);

            this.blurMaterials[i].uniforms.tMap.value = this.renderTargetsHorizontal[i].texture;
            this.blurMaterials[i].uniforms.uDirection.value = BlurDirectionY;
            renderer.setRenderTarget(renderTargetsVertical[i]);
            renderer.render(this.screen, this.screenCamera);

            inputRenderTarget = renderTargetsVertical[i];
        }

        // Composite all the mips
        this.screen.material = this.bloomCompositeMaterial;
        renderer.setRenderTarget(renderTargetsHorizontal[0]);
        renderer.render(this.screen, this.screenCamera);

        // Composite pass (render to screen)
        this.compositeMaterial.uniforms.tScene.value = renderTarget.texture;
        this.compositeMaterial.uniforms.tBloom.value = renderTargetsHorizontal[0].texture;
        this.screen.material = this.compositeMaterial;
        renderer.setRenderTarget(null);
        renderer.render(this.screen, this.screenCamera);
    };
}

class CameraController {
    static init(camera) {
        this.camera = camera;

        this.mouse = new Vector2();
        this.lookAt = new Vector3(0, 0, -2);
        this.origin = new Vector3();
        this.target = new Vector3();
        this.targetXY = new Vector2(5, 1);
        this.origin.copy(this.camera.position);

        this.lerpSpeed = 0.02;
        this.enabled = false;

        this.addListeners();
    }

    static addListeners() {
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('resize', this.onWindowResize); // Ensure resize event is handled
    }

    // Event handlers

    static onPointerDown = e => {
        this.onPointerMove(e);
    };

    static onPointerMove = ({ clientX, clientY }) => {
        if (!this.enabled) {
            return;
        }

        this.mouse.x = (clientX / document.documentElement.clientWidth) * 2 - 1;
        this.mouse.y = 1 - (clientY / document.documentElement.clientHeight) * 2;
    };

    static onPointerUp = e => {
        this.onPointerMove(e);
    };

    static onWindowResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.resize(width, height); // Ensure resize method is called
    };

    // Public methods

    static resize = (width, height) => {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        if (width < height) {
            this.camera.position.z = 14;
        } else {
            this.camera.position.z = 10;
        }

        this.origin.z = this.camera.position.z;

        this.camera.lookAt(this.lookAt);
    };

    static update = () => {
        if (!this.enabled) {
            return;
        }

        this.target.x = this.origin.x + this.targetXY.x * this.mouse.x;
        this.target.y = this.origin.y + this.targetXY.y * this.mouse.y;
        this.target.z = this.origin.z;

        this.camera.position.lerp(this.target, this.lerpSpeed);
        this.camera.lookAt(this.lookAt);
    };

    static animateIn = () => {
        this.enabled = true;
    };
}

class WorldController {
    static init() {
        this.initWorld();
        this.initLights();
        this.initLoaders();

        this.addListeners();
    }

    static initWorld() {
        this.renderer = new WebGLRenderer({
            powerPreference: 'high-performance',
            antialias: true
        });

        // Disable color management
        ColorManagement.enabled = false;
        this.renderer.outputColorSpace = LinearSRGBColorSpace;

        // Output canvas
        this.element = this.renderer.domElement;

        // 3D scene
        this.scene = new Scene();
        this.scene.background = new Color(0x060606);
        this.scene.fog = new Fog(this.scene.background, 1, 100);
        this.camera = new PerspectiveCamera(30);
        this.camera.near = 0.5;
        this.camera.far = 40;
        this.camera.position.z = 10;
        this.camera.lookAt(this.scene.position);

        // Global geometries
        this.screenTriangle = getFullscreenTriangle();

        // Global uniforms
        this.resolution = { value: new Vector2() };
        this.texelSize = { value: new Vector2() };
        this.aspect = { value: 1 };
        this.time = { value: 0 };
        this.frame = { value: 0 };
    }

    static initLights() {
        this.scene.add(new HemisphereLight(0x606060, 0x404040, 3));

        const light = new DirectionalLight(0xffffff, 2);
        light.position.set(1, 1, 1);
        this.scene.add(light);
    }

    static initLoaders() {
        this.textureLoader = new TextureLoader();
        this.svgLoader = new SVGLoader();
    }

    static addListeners() {
        this.renderer.domElement.addEventListener('touchstart', this.onTouchStart);
        window.addEventListener('resize', this.onWindowResize); // Add this line
    }

    // Event handlers

    static onWindowResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = window.devicePixelRatio;
        this.resize(width, height, dpr); // Ensure resize method is called
    };

    static onTouchStart = e => {
        e.preventDefault();
    };

    // Public methods

    static resize = (width, height, dpr) => {
        width = Math.round(width * dpr);
        height = Math.round(height * dpr);

        this.renderer.setSize(width, height); // Ensure renderer size is updated
        this.resolution.value.set(width, height);
        this.texelSize.value.set(1 / width, 1 / height);
        this.aspect.value = width / height;
        this.camera.aspect = width / height; // Update camera aspect ratio
        this.camera.updateProjectionMatrix(); // Ensure camera projection matrix is updated
    };

    static update = (time, delta, frame) => {
        this.time.value = time;
        this.frame.value = frame;
    };

    // Global handlers

    static getTexture = (path, callback) => this.textureLoader.load(path, callback);

    static loadTexture = path => this.textureLoader.loadAsync(path);

    static loadSVG = path => this.svgLoader.loadAsync(path);
}

class App {
    static async init() {
        this.initWorld();
        this.initViews();
        this.initControllers();

        this.addListeners();
        this.onResize();

        await SceneController.ready();

        this.initPanel();

        CameraController.animateIn();
        SceneController.animateIn();
    }

    static initWorld() {
        WorldController.init();
        document.body.appendChild(WorldController.element);
    }

    static initViews() {
        this.view = new SceneView();
        WorldController.scene.add(this.view);

        this.ui = new UI({ fps: true }); // Ensure FPS meter is enabled
        this.ui.animateIn();
        document.body.appendChild(this.ui.element);
    }

    static initControllers() {
        const { renderer, scene, camera } = WorldController;

        CameraController.init(camera);
        SceneController.init(this.view);
        RenderManager.init(renderer, scene, camera);
    }

    static initPanel() {
        console.log("Initializing Panel..."); // Debugging line
        PanelController.init(this.ui); // Ensure PanelController is initialized with the UI instance
    }

    static addListeners() {
        window.addEventListener('resize', this.onResize);
        ticker.add(this.onUpdate);
        ticker.start();
    }

    // Event handlers

    static onResize = () => {
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const dpr = window.devicePixelRatio;

        WorldController.resize(width, height, dpr);
        CameraController.resize(width, height);
        SceneController.resize(width, height);
        RenderManager.resize(width, height, dpr);
    };

    static onUpdate = (time, delta, frame) => {
        WorldController.update(time, delta, frame);
        CameraController.update();
        SceneController.update();
        RenderManager.update(time, delta, frame);
        this.ui.update();
    };
}


App.init();
