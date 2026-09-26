// Three.js Scene Setup & 3D GLTF Avatar Manager
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

export class Scene3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.character = null;
    this.isSpeaking = false;
    this.clock = new THREE.Clock();
    this.mixer = null;
    this.gltfLoaded = false;
    this.fallbackMesh = null;
    this.auraMesh = null;
    this.eyeMeshL = null;
    this.eyeMeshR = null;

    this.init();
  }

  init() {
    // 1. Scene setup
    this.scene = new THREE.Scene();

    // 2. Camera setup
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(0, 0.2, 5);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. Pastel Ambient & Directional Lighting
    const ambientLight = new THREE.AmbientLight(0xfef08a, 0.9); // soft warm pastel yellow
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xc084fc, 1.2); // soft purple glow
    dirLight1.position.set(5, 10, 7);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.8); // pastel sky blue fill
    dirLight2.position.set(-5, -2, -5);
    this.scene.add(dirLight2);

    const pointLight = new THREE.PointLight(0xf472b6, 1.5, 10); // pastel pink accent
    pointLight.position.set(0, 1, 2);
    this.scene.add(pointLight);

    // 5. Load GLTF or create aesthetic fallback character
    this.loadGLTFModel('./assets/img/ia.gltf');

    // 6. Responsive Resize listener
    window.addEventListener('resize', () => this.onWindowResize());

    // 7. Mouse move interaction (character subtle tilt following cursor)
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));

    // 8. Start loop
    this.animate();
  }

  loadGLTFModel(gltfPath) {
    const loader = new GLTFLoader();

    loader.load(
      gltfPath,
      (gltf) => {
        const model = gltf.scene;
        model.position.set(0, -0.6, 0); // Position slightly lower for thought bubbles space
        model.scale.set(1, 1, 1);

        // Adjust model materials if needed
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.scene.add(model);
        this.character = model;
        this.gltfLoaded = true;

        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(model);
          const action = this.mixer.clipAction(gltf.animations[0]);
          action.play();
        }
      },
      (xhr) => {
        // Loading progress
      },
      (error) => {
        console.warn('Could not load target GLTF file or placeholder is empty, building fallback 3D pastel avatar character.');
        this.createFallbackAvatar();
      }
    );
  }

  createFallbackAvatar() {
    // Elegant floating pastel AI creature avatar
    const group = new THREE.Group();
    group.position.set(0, -0.3, 0);

    // Main Sphere Body (Lavender/Pastel Gradient Material)
    const bodyGeo = new THREE.SphereGeometry(0.8, 64, 64);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xc4b5fd,
      roughness: 0.2,
      metalness: 0.1,
      emissive: 0x8b5cf6,
      emissiveIntensity: 0.15,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(bodyMesh);
    this.fallbackMesh = bodyMesh;

    // Glowing Holographic Outer Ring
    const torusGeo = new THREE.TorusGeometry(1.25, 0.03, 16, 100);
    const torusMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.5,
      roughness: 0.1,
    });
    this.auraMesh = new THREE.Mesh(torusGeo, torusMat);
    this.auraMesh.rotation.x = Math.PI / 3;
    group.add(this.auraMesh);

    // Cute Expressive Eyes
    const eyeGeo = new THREE.SphereGeometry(0.1, 32, 32);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1e1b4b });

    this.eyeMeshL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeMeshL.position.set(-0.28, 0.2, 0.72);
    group.add(this.eyeMeshL);

    this.eyeMeshR = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeMeshR.position.set(0.28, 0.2, 0.72);
    group.add(this.eyeMeshR);

    // Cute Floating Halo
    const haloGeo = new THREE.TorusGeometry(0.4, 0.025, 16, 60);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 1.15, 0);
    halo.rotation.x = Math.PI / 2.2;
    group.add(halo);

    this.scene.add(group);
    this.character = group;
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  onMouseMove(event) {
    if (!this.character) return;
    const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

    // Smoothly tilt character toward cursor
    this.character.rotation.y = THREE.MathUtils.lerp(this.character.rotation.y, mouseX * 0.35, 0.05);
    this.character.rotation.x = THREE.MathUtils.lerp(this.character.rotation.x, -mouseY * 0.2, 0.05);
  }

  setSpeakingState(speaking) {
    this.isSpeaking = speaking;
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    if (this.mixer) {
      this.mixer.update(delta);
    }

    if (this.character) {
      // Idle levitation animation
      const levitationSpeed = this.isSpeaking ? 6 : 2.5;
      const levitationHeight = this.isSpeaking ? 0.08 : 0.05;
      this.character.position.y = (this.gltfLoaded ? -0.6 : -0.3) + Math.sin(elapsedTime * levitationSpeed) * levitationHeight;

      // Pulse aura ring if present
      if (this.auraMesh) {
        this.auraMesh.rotation.z += 0.01;
        const scale = 1 + Math.sin(elapsedTime * (this.isSpeaking ? 8 : 3)) * 0.05;
        this.auraMesh.scale.set(scale, scale, scale);
      }

      // Eye scale pulse when speaking (talking motion)
      if (this.eyeMeshL && this.eyeMeshR && this.isSpeaking) {
        const eyeScaleY = 0.5 + Math.abs(Math.sin(elapsedTime * 12)) * 0.7;
        this.eyeMeshL.scale.setY(eyeScaleY);
        this.eyeMeshR.scale.setY(eyeScaleY);
      } else if (this.eyeMeshL && this.eyeMeshR) {
        this.eyeMeshL.scale.setY(1);
        this.eyeMeshR.scale.setY(1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
