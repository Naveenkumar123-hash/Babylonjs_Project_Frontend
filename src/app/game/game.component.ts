import { Component, ElementRef, ViewChild, OnInit } from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import * as Colyseus from 'colyseus.js';
import earcut from 'earcut';
import { Schema, MapSchema } from "@colyseus/schema";


BABYLON.PolygonMeshBuilder.prototype.bjsEarcut = earcut;

interface PositionData {
  x: number;
  y: number;
  z: number;
}

class ShapeState extends Schema {
  position!: { x: number, y: number, z: number };
  vertices!: { x: number, y: number, z: number }[];
}

interface ShapeDetails {
  position: { x: number; y: number; z: number };
  vertices: Array<{ x: number; y: number; z: number }>;
}

interface ShapeData {
  name: string;
  position: PositionData;
  vertices: PositionData[];
}


@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss']
})
export class GameComponent implements OnInit {
  @ViewChild('renderCanvas', { static: true }) renderCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawingCanvas', { static: true }) drawingCanvas!: ElementRef<HTMLCanvasElement>;

  private engine!: BABYLON.Engine;
  private scene!: BABYLON.Scene;
  private drawingContext: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private currentShape: BABYLON.Vector3[] = [];
  private selectedShape: BABYLON.Mesh | null = null;
  private dragPlane: BABYLON.Plane | null = null;
  private client!: Colyseus.Client;
  private room!: Colyseus.Room;
  private selectedMesh: BABYLON.AbstractMesh | null = null;
  private shapes: Map<string, BABYLON.Mesh> = new Map();
  private ground!: BABYLON.Mesh;
  private mesh: BABYLON.Mesh | undefined;
  private channel: BroadcastChannel | undefined;
  private startingPoint: BABYLON.Nullable<BABYLON.Vector3> = null;
  private isConnected: boolean = false

  constructor() { }


  ngOnInit() {
    this.initializeEngine();
    this.createScene();
    this.connectToServer()
    this.initializeDrawingCanvas();
    this.setupMouseControls();
    this.animate();
  }

  private initializeEngine(): void {
    this.engine = new BABYLON.Engine(this.renderCanvas.nativeElement);
  }


  private createScene(): void {
    // Create the scene
    this.scene = new BABYLON.Scene(this.engine);

    // Create and configure the camera
    const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 10, BABYLON.Vector3.Zero(), this.scene);
    camera.attachControl(this.renderCanvas.nativeElement, true);

    // Add lighting to the scene
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), this.scene);

    this.ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 5, height: 5 }, this.scene);
    this.ground.isPickable = true;
  }

  private initializeDrawingCanvas(): void {
    const canvas = this.drawingCanvas.nativeElement;
    this.drawingContext = canvas.getContext('2d');
    if (!this.drawingContext) {
      console.error('Could not get 2D context from canvas');
      return;
    }
    canvas.width = 500;
    canvas.height = 500;

    canvas.addEventListener('mousedown', this.startDrawing.bind(this));
    canvas.addEventListener('mousemove', this.draw.bind(this));
    canvas.addEventListener('mouseup', this.stopDrawing.bind(this));
  }

  private startDrawing(event: MouseEvent): void {
    if (!this.drawingContext) return;
    this.isDrawing = true;
    const rect = this.drawingCanvas.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.currentShape = [new BABYLON.Vector3(x, y, 0)];
    this.drawingContext.beginPath();
    this.drawingContext.moveTo(x, y);
  }

  private draw(event: MouseEvent): void {
    if (!this.isDrawing || !this.drawingContext) return;
    const rect = this.drawingCanvas.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.currentShape.push(new BABYLON.Vector3(x, y, 0));
    this.drawingContext.lineTo(x, y);
    this.drawingContext.stroke();
  }

  private stopDrawing(): void {
    if (!this.drawingContext) return;
    this.isDrawing = false;
    console.log(this.scene.meshes)
    this.drawingContext.closePath();
  }

  extrudeShape(): void {

    if (this.currentShape.length < 3) {
      console.warn('Need at least 3 points to create a shape');
      return;
    }

    const scaledShape = this.currentShape.map(point => new BABYLON.Vector3(
      this.ensureNumber((point.x / 100) - 2.5),
      0,
      this.ensureNumber(-((point.y / 100) - 2.5))
    ));

    // Generate a unique name for the shape
    const shapeName = `extruded_${Date.now()}`;

    const polygonTriangulation = {
      shape: scaledShape,
      depth: 1,
      updatable: true
    };

    const shape = BABYLON.MeshBuilder.ExtrudePolygon(shapeName, polygonTriangulation, this.scene, earcut);
    this.mesh = shape;
    this.mesh.isPickable = true;

    shape.position.y = 0.5;

    const material = new BABYLON.StandardMaterial("shapeMaterial", this.scene);
    material.diffuseColor = new BABYLON.Color3(Math.random(), Math.random(), Math.random());
    shape.material = material;

    if (this.drawingContext) {
      this.drawingContext.clearRect(0, 0, this.drawingCanvas.nativeElement.width, this.drawingCanvas.nativeElement.height);
    }
    this.currentShape = [];


    // Send the new shape's data to the server
    this.createShape({
      name: shapeName,
      position: {
        x: this.ensureNumber(shape.position.x),
        y: this.ensureNumber(shape.position.y),
        z: this.ensureNumber(shape.position.z)
      },
      vertices: scaledShape.map(v => ({
        x: this.ensureNumber(v.x),
        y: this.ensureNumber(v.y),
        z: this.ensureNumber(v.z)
      }))
    });
  }

  private ensureNumber(value: any): number {
    return isNaN(value) ? 0 : Number(value);
  }


  private animate(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  private connectToServer(): void {
    const client = new Colyseus.Client('https://babylonjs-project-backend.onrender.com');
    const joinRoom = () => {
      client.joinOrCreate<any>("game_room").then(room => {
        this.room = room;
        this.isConnected = true;
        console.log("Connected to room:", room.name);

        this.room.onLeave((code) => {
          this.isConnected = false;
          console.warn(`Left the room with code: ${code}`);
          setTimeout(() => this.connectToServer(), 1000);
        });

        this.room.onError((code, message) => {
          this.isConnected = false;
          console.error(`Error ${code}: ${message}`);
          setTimeout(() => this.connectToServer(), 1000);
        });

        // Handle state and message listeners
        this.room.onStateChange((state) => {
          console.log("State change detected:", state.shapes);
          if (state.shapes && state.shapes.size > 0) {
            state.shapes.forEach((shapeDetails: any, shapeName: any) => {
              if (shapeDetails && this.isValidShape(shapeDetails)) {
                this.renderShape(shapeName, shapeDetails);
              } else {
                console.warn(`Invalid shape data for: ${shapeName}`, shapeDetails);
              }
            });
          } else {
            console.warn('No shapes found to render.');
          }
        });

        this.room.onMessage("UpdateShapes", (shapesData: Array<[string, ShapeDetails]>) => {
          shapesData.forEach(([shapeName, shapeDetails]) => {
            this.renderShape(shapeName, shapeDetails);
          });
        });

        // this.room.onMessage("moveShape", (data) => {
        //     const { name, position } = data;
        //     this.eventManager.trigger('moveShape', { name, position });
        // });

        this.room.onMessage("MeshPositionUpdated", (data) => {
          const { name, position } = data;
          const mesh = this.scene.getMeshByName(name);
          if (mesh) {
            mesh.position.set(position.x, position.y, position.z);
          }
        });
      }).catch(e => {
        this.isConnected = false
        console.error("Join error:", e);
        setTimeout(joinRoom, 1000); // Retry after 1 second
      });
    };
    joinRoom();
  }



  isValidShape(shapeDetails: any) {
    const isValid = shapeDetails && shapeDetails.position && shapeDetails.vertices;
    return isValid;
  }

  private setupMouseControls(): void {
    this.scene.onPointerObservable.add((pointerInfo: any) => {
      const currentPoint = this.getGroundPosition();

      switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
          this.onPointerDown(pointerInfo);
          break;

        case BABYLON.PointerEventTypes.POINTERUP:
          // Check if pickInfo is available and valid
          if (pointerInfo.pickInfo) {
            const pickResult = this.scene.pick(pointerInfo.pickInfo.x, pointerInfo.pickInfo.y);
            if (pickResult.hit) {
              console.log("Picked mesh:", pickResult.pickedMesh);
            } else {
              console.log("No mesh was picked.");
            }
          }

          const pickInfo = this.getGroundPosition(); // Call to get the pick info
          this.onPointerUp(pointerInfo.event, pickInfo);
          break;

        case BABYLON.PointerEventTypes.POINTERMOVE:
          // Handle POINTERMOVE without accessing pickInfo directly
          this.onPointerMove(pointerInfo);
          break;
      }
    });
  }


  private moveShape(name: string, position: { x: number; y: number; z: number }) {
    const shape = this.shapes.get(name);
    if (shape) {
      shape.position.x = position.x;
      shape.position.y = position.y;
      shape.position.z = position.z;
    }
  }

  private onPointerDown = (pointerInfo: BABYLON.PointerInfo): void => {
    const evt = pointerInfo.event as BABYLON.IPointerEvent;
    const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => mesh !== this.ground); // Exclude ground
    if (evt.button !== 0) return; // Only react to left mouse button

    if (pickInfo && pickInfo.hit) {
      this.selectedMesh = pickInfo.pickedMesh as BABYLON.Mesh;
      this.startingPoint = pickInfo.pickedPoint!.clone();
      console.log("Picked mesh:", this.selectedMesh?.name);
    }
  };


  private onPointerUp(evt: any, pickInfo: any | null): void {
    if (pickInfo && pickInfo.hit && pickInfo.pickedMesh?.name !== 'ground') {
      this.selectedMesh = pickInfo.pickedMesh as BABYLON.Mesh;
      if (this.selectedMesh) {
        this.selectedMesh.position.copyFrom(pickInfo.pickedPoint as BABYLON.Vector3);
      }
    }
  }


  private onPointerMove = (pointerInfo: BABYLON.PointerInfo): void => {
    const evt = pointerInfo.event as BABYLON.IPointerEvent;
    if (!this.selectedMesh) return; // Only move if a mesh is selected
    const pickInfo = this.getGroundPosition(false); // Allow picking any mesh
    if (!pickInfo || !pickInfo.hit) return;

    const currentPoint = pickInfo.pickedPoint as BABYLON.Vector3;
    if (!this.startingPoint) {
        this.startingPoint = currentPoint.clone();
        return;
    }

    const diff = currentPoint.subtract(this.startingPoint);
    this.selectedMesh.position.addInPlace(diff);
    this.startingPoint.copyFrom(currentPoint);

    // Send new position to server
    if (this.room && this.isConnected) {
        console.log("Sending mesh position to server:", {
            name: this.selectedMesh.name,
            position: {
                x: this.selectedMesh.position.x,
                y: this.selectedMesh.position.y,
                z: this.selectedMesh.position.z
            }
        });
        this.room.send("moveMesh", {
            name: this.selectedMesh.name,
            position: {
                x: this.selectedMesh.position.x,
                y: this.selectedMesh.position.y,
                z: this.selectedMesh.position.z
            }
        });
    } else {
        console.warn("WebSocket is not open. Cannot send message.");
    }
};





  getGroundPosition = (excludeGround: boolean = true): BABYLON.Nullable<BABYLON.PickingInfo> => {
    const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => !excludeGround || mesh !== this.ground);
    return pickInfo;
  };

  renderShape(shapeName: any, shapeDetails: any) {
    // If shapeDetails.vertices is an ArraySchema, convert it to a plain array
    const vertices = shapeDetails.vertices ? shapeDetails.vertices.toArray() : [];
    // Continue rendering the shape, using the plain array of vertices
    if (vertices.length > 0) {
      this.drawShape(shapeName, vertices);
    } else {
      console.warn(`Shape ${shapeName} has no vertices`);
    }
  }


  drawShape(shapeName: string, vertices: Array<any>) {
    const scaledShape = vertices.map(point => new BABYLON.Vector3(
      this.ensureNumber(point.x), // Assuming point.x is in the first position
      this.ensureNumber(point.y), // Assuming point.y is in the second position
      this.ensureNumber(point.z)  // Assuming point.z is in the third position
    ));
    let mesh = this.scene.getMeshByName(shapeName);
    if (!mesh) {
      const polygonTriangulation = {
        shape: scaledShape,
        depth: 1, // Adjust the depth for extrusion if needed
        updatable: true // Allow updating the shape later if necessary
      };
      mesh = BABYLON.MeshBuilder.ExtrudePolygon(shapeName, polygonTriangulation, this.scene, earcut);
      mesh.isPickable = true;
    } else {

    }
  }



  createMeshFromVertices(vertices: any) {
    const points = vertices.map((vertex: any) => new BABYLON.Vector3(vertex.x, vertex.y, vertex.z));
    const shape = BABYLON.MeshBuilder.CreatePolygon("shape", { shape: points }, this.scene);
    return shape;
  }

  private createShape(shapeData: any): void {
    const chunkSize = 10;
    const totalChunks = Math.ceil(shapeData.vertices.length / chunkSize);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = shapeData.vertices.slice(i * chunkSize, (i + 1) * chunkSize);
      const chunkData = {
        name: shapeData.name,
        position: shapeData.position,
        vertices: chunk,
        totalChunks: totalChunks
      };
      if (this.room) {
        this.room.send("shapeChunk", chunkData);
      }
    }
  }
}