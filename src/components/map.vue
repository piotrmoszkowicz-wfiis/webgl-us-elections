<template>
  <div class="map-us">
    <div class="hide-all">
      <svg
        ref="map-svg"
        class="map-svg"
        viewBox="0 0 960 600"
        preserveAspectRatio="xMidYMid meet"
      ></svg>
      <canvas class="packed-counties-canvas" ref="packed-counties-canvas" />
    </div>

    <select class="selector" v-model="year">
      <option v-for="(optYear, key) in years" :key="key" :value="optYear">{{
        optYear
      }}</option>
    </select>

    <canvas class="counties-webgl-canvas" ref="counties-webgl-canvas" />
  </div>
</template>

<script>
import * as d3 from "d3";
import * as topojson from "topojson-client";

import us from "@/data/us-10m.v1.json";
import GrowingPacker from "@/utils/GrowingPacker";
import * as THREE from "three";

import data_2000 from "@/data/2000.json";
import data_2004 from "@/data/2004.json";
import data_2008 from "@/data/2008.json";
import data_2012 from "@/data/2012.json";
import data_2016 from "@/data/2016.json";

const data = {
  2000: data_2000,
  2004: data_2004,
  2008: data_2008,
  2012: data_2012,
  2016: data_2016
};

export default {
  name: "map",
  data: () => ({
    colorData: data[2000],
    year: 2000,
    years: [2000, 2004, 2008, 2012, 2016],

    scale: 1.345,
    vertexShader: `
      precision highp float;

      uniform float sineTime;

      uniform float time;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;

      attribute vec2 uv;
      varying vec2 vUv;

      attribute float countyIndex;
      attribute vec4 countyTag;
      attribute vec3 position;
      attribute vec3 offset;
      attribute vec4 color;
      attribute vec4 orientationStart;
      attribute vec4 orientationEnd;
      attribute vec2 uvOffsets;
      attribute vec2 uvScales;
      varying vec4 vCountyTag;

      void main(){
        vCountyTag = countyTag;
        vec3 pos = position * vec3(uvScales.xy * 1024.0, 1.0);
        pos = pos + offset;

        vUv = vec2(uv.x, 1.0-uv.y);
        vUv *= uvScales;
        vUv = vec2(vUv.x, 1.0-vUv.y);
        vUv += vec2(uvOffsets.x , uvOffsets.y);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0 );
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float time;
      uniform sampler2D map;
      uniform float isPicking;
      varying vec2 vUv;
      varying float vRatio;
      varying vec4 vCountyTag;

      void main() {
        vec2 uv = vUv;
        vec4 color = texture2D(map, uv);
        if (color.x + color.y + color.z < 0.9) {
          discard;
        }
        gl_FragColor = vCountyTag;
      }
    `,
    counties: [],
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerWidth
  }),
  mounted() {
    this.createD3Map();
    const blocks = this.runTexturePacker();
    this.counties.push(...blocks);
    this.drawCounties();
    this.createWebGLMap();
  },
  methods: {
    createD3Map() {
      const svg = d3.select(this.$refs["map-svg"]);
      const path = d3.geoPath();
      svg
        .append("g")
        .attr("class", "counties")
        .selectAll("path")
        .data(topojson.feature(us, us.objects.counties).features)
        .enter()
        .append("path")
        .attr("id", e => e.id)
        .attr("d", path);
    },
    runTexturePacker() {
      const blocks = [
        ...this.$refs["map-svg"].querySelectorAll("g.counties path")
      ]
        .map(path => {
          const { x, y, width, height } = path.getBBox();
          return {
            id: parseInt(path.getAttribute("id")),
            x: x * this.scale,
            y: y * this.scale,
            w: width * this.scale,
            h: height * this.scale,
            path
          };
        })
        .sort((a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h));

      const packer = new GrowingPacker();
      packer.fit(blocks);
      return blocks;
    },
    drawCounties() {
      const canvasPacked = this.$refs["packed-counties-canvas"];
      canvasPacked.width = 1024;
      canvasPacked.height = 1024;
      const contextPacked = canvasPacked.getContext("2d");
      contextPacked.strokeStyle = "transparent";
      contextPacked.lineWidth = 0;
      contextPacked.fillStyle = "transparent";
      contextPacked.rect(0, 0, canvasPacked.width, canvasPacked.height);
      contextPacked.stroke();
      contextPacked.fill();
      contextPacked.fillStyle = "white";

      let i = 0;
      for (let block of this.counties) {
        if (block.fit) {
          const path = new Path2D(block.path.getAttribute("d"));

          contextPacked.save();
          contextPacked.translate(-block.x, -block.y);
          contextPacked.translate(block.fit.x, block.fit.y);
          contextPacked.scale(this.scale, this.scale);
          contextPacked.stroke(path);
          contextPacked.fill(path);

          contextPacked.restore();
        } else {
          // eslint-disable-next-line
          console.warn(`Error packing county at ${i}`);
        }
        i++;
      }
    },
    createWebGLMap() {
      let camera,
        scene,
        renderer,
        mouseIsDown = false;
      const clock = new THREE.Clock();
      let mesh;
      let pickingRenderTarget;
      const canvas = this.$refs["counties-webgl-canvas"];

      const init = () => {
        renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          antialias: true,
          alpha: true
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(this.canvasWidth, this.canvasHeight);
        if (renderer.extensions.get("ANGLE_instanced_arrays") === null) {
          alert("This experiment is not supoprted by your browser.");
          return;
        }
        camera = new THREE.PerspectiveCamera(
          50,
          this.canvasWidth / this.canvasHeight,
          1,
          10000
        );
        camera.position.z = 1000;

        scene = new THREE.Scene();

        pickingRenderTarget = new THREE.WebGLRenderTarget(
          this.canvasWidth,
          this.canvasHeight
        );

        const instances = this.counties.length;
        const countyIndexes = [];
        const countyTags = [];
        const offsets = [];
        const uvOffsets = [];
        const uvScales = [];
        for (let i = 0, l = this.counties.length; i < l; i++) {
          const block = this.counties[i];

          const code = block.id;
          const colorData = this.colorData[code.toString()] ?? {
            color: { r: 1, g: 1, b: 1 }
          };
          const { color } = colorData;

          countyIndexes.push(i);
          countyTags.push(color.r, color.g, color.b, 1);
          offsets.push(
            block.x - 650 + block.w / 2,
            -block.y + 380 - block.h / 2,
            0
          );
          uvOffsets.push(block.fit.x / 1024, -block.fit.y / 1024);
          uvScales.push(block.w / 1024, block.h / 1024);
        }

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.copy(new THREE.PlaneBufferGeometry(1, 1, 1, 1));

        geometry.maxInstancedCount = instances; // set so its initalized for dat.GUI, will be set in first draw otherwise

        geometry.setAttribute(
          "countyIndex",
          new THREE.InstancedBufferAttribute(new Float32Array(countyIndexes), 1)
        );
        geometry.setAttribute(
          "countyTag",
          new THREE.InstancedBufferAttribute(new Float32Array(countyTags), 4)
        );
        geometry.setAttribute(
          "offset",
          new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3)
        );
        geometry.setAttribute(
          "uvOffsets",
          new THREE.InstancedBufferAttribute(new Float32Array(uvOffsets), 2)
        );
        geometry.setAttribute(
          "uvScales",
          new THREE.InstancedBufferAttribute(new Float32Array(uvScales), 2)
        );
        const canvasTexture = new THREE.CanvasTexture(
          this.$refs["packed-counties-canvas"]
        );

        const material = new THREE.RawShaderMaterial({
          uniforms: {
            map: { value: canvasTexture },
            time: { value: 1.0 },
            sineTime: { value: 1.0 },
            isPicking: { type: "f", value: 0.0 }
          },
          vertexShader: this.vertexShader,
          fragmentShader: this.fragmentShader,
          side: THREE.FrontSide,
          transparent: true
        });

        mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        scene.add(mesh);

        window.addEventListener("resize", onWindowResize, false);
        onWindowResize();
      };

      const onWindowResize = () => {
        this.canvasWidth = window.innerWidth;
        this.canvasHeight = window.innerHeight;
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;
        camera.aspect = this.canvasWidth / this.canvasHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(this.canvasWidth, this.canvasHeight);
        pickingRenderTarget.setSize(this.canvasWidth, this.canvasHeight);
        render(clock.getDelta());
      };

      const animate = () => {
        requestAnimationFrame(animate);
        const time = clock.getDelta();
        if (mouseIsDown) {
          render(time);
        }
      };

      const render = time => {
        const object = scene.children[0];
        object.material.uniforms.time.value =
          object.material.uniforms.time.value + time * 1;
        renderer.render(scene, camera);
      };

      init();
      animate();
      render(clock.getDelta());
    }
  },
  watch: {
    year: function(newVal) {
      this.colorData = data[newVal];
      this.createWebGLMap();
    }
  }
};
</script>

<style lang="scss">
body {
  background: white;
  margin: 0;
  width: 100vw;
  .map-us {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    .hide-all {
      visibility: hidden;
      opacity: 0;
      width: 0;
      height: 0;
      overflow: hidden;
    }

    canvas.counties-webgl-canvas {
      width: 100vw;
      height: auto;
    }

    .selector {
      z-index: 10;
      position: absolute;
      left: 5%;
      top: 10%;
    }
  }
}
</style>
