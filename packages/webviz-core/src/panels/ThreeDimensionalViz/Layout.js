// @flow
//
//  Copyright (c) 2018-present, GM Cruise LLC
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import CloseIcon from "@mdi/svg/svg/close.svg";
import cx from "classnames";
import { vec3, quat } from "gl-matrix";
import { get } from "lodash";
import * as React from "react";
import Draggable from "react-draggable";
import KeyListener from "react-key-listener";
import {
  cameraStateSelectors,
  PolygonBuilder,
  DrawPolygons,
  type CameraState,
  type ReglClickInfo,
  type MouseEventObject,
} from "regl-worldview";

import type { ThreeDimensionalVizConfig } from ".";
import Icon from "webviz-core/src/components/Icon";
import PanelToolbar from "webviz-core/src/components/PanelToolbar";
import useGlobalData, { type GlobalData } from "webviz-core/src/hooks/useGlobalData";
import { getGlobalHooks } from "webviz-core/src/loadWebviz";
import DebugStats from "webviz-core/src/panels/ThreeDimensionalViz/DebugStats";
import DrawingTools, {
  DRAWING_CONFIG,
  type DrawingType,
} from "webviz-core/src/panels/ThreeDimensionalViz/DrawingTools";
import MeasuringTool, { type MeasureInfo } from "webviz-core/src/panels/ThreeDimensionalViz/DrawingTools/MeasuringTool";
import FollowTFControl from "webviz-core/src/panels/ThreeDimensionalViz/FollowTFControl";
import Interactions, {
  InteractionContextMenu,
  type InteractionData,
} from "webviz-core/src/panels/ThreeDimensionalViz/Interactions";
import useLinkedGlobalVariables, {
  type LinkedGlobalVariables,
} from "webviz-core/src/panels/ThreeDimensionalViz/Interactions/useLinkedGlobalVariables";
import styles from "webviz-core/src/panels/ThreeDimensionalViz/Layout.module.scss";
import MainToolbar from "webviz-core/src/panels/ThreeDimensionalViz/MainToolbar";
import SceneBuilder, { type TopicSettingsCollection } from "webviz-core/src/panels/ThreeDimensionalViz/SceneBuilder";
import TopicSelector from "webviz-core/src/panels/ThreeDimensionalViz/TopicSelector";
import type { Selections } from "webviz-core/src/panels/ThreeDimensionalViz/TopicSelector/treeBuilder";
import TopicSettingsEditor, { canEditDatatype } from "webviz-core/src/panels/ThreeDimensionalViz/TopicSettingsEditor";
import Transforms from "webviz-core/src/panels/ThreeDimensionalViz/Transforms";
import TransformsBuilder from "webviz-core/src/panels/ThreeDimensionalViz/TransformsBuilder";
import type { Extensions } from "webviz-core/src/reducers/extensions";
import { topicsByTopicName } from "webviz-core/src/selectors";
import inScreenshotTests from "webviz-core/src/stories/inScreenshotTests";
import type { SaveConfig } from "webviz-core/src/types/panels";
import type { Frame, Topic } from "webviz-core/src/types/players";
import type { MarkerCollector, MarkerProvider } from "webviz-core/src/types/Scene";
import videoRecordingMode from "webviz-core/src/util/videoRecordingMode";

type EventName = "onDoubleClick" | "onMouseMove" | "onMouseDown" | "onMouseUp";
export type ClickedPosition = { clientX: number, clientY: number };

type WrapperProps = {
  autoTextBackgroundColor?: boolean,
  cameraState: $Shape<CameraState>,
  checkedNodes: string[],
  children?: React.Node,
  cleared?: boolean,
  currentTime: {| sec: number, nsec: number |},
  expandedNodes: string[],
  extensions: Extensions,
  followOrientation: boolean,
  followTf?: string | false,
  frame?: Frame,
  helpContent: React.Node | string,
  modifiedNamespaceTopics: string[],
  onAlignXYAxis: () => void,
  onCameraStateChange: (CameraState) => void,
  onFollowChange: (followTf?: string | false, followOrientation?: boolean) => void,
  pinTopics: boolean,
  saveConfig: SaveConfig<ThreeDimensionalVizConfig>,
  selectedPolygonEditFormat: "json" | "yaml",
  selections: Selections,
  setSelections: (Selections) => void,
  showCrosshair: ?boolean,
  topics: Topic[],
  topicSettings: TopicSettingsCollection,
  transforms: Transforms,
};

type Props = WrapperProps & {
  globalData: GlobalData,
  setGlobalData: (GlobalData) => void,
  linkedGlobalVariables: LinkedGlobalVariables,
};

type State = {
  sceneBuilder: SceneBuilder,
  transformsBuilder: TransformsBuilder,
  cachedTopicSettings: TopicSettingsCollection,
  editedTopics: string[],
  debug: boolean,
  showTopics: boolean,
  metadata: any,
  editTipX: ?number,
  editTipY: ?number,
  editTopic: ?Topic,
  drawingType: ?DrawingType,
  polygonBuilder: PolygonBuilder,
  measureInfo: MeasureInfo,
  selectedObject: ?MouseEventObject,
  selectedObjects: ?(MouseEventObject[]),
  clickedPosition: ?ClickedPosition,
};

class BaseComponent extends React.Component<Props, State> implements MarkerProvider {
  // overall element containing everything in this component
  el: ?HTMLDivElement;
  measuringTool: ?MeasuringTool;

  static defaultProps = {
    checkedNodes: [],
    expandedNodes: [],
    modifiedNamespaceTopics: [],
    topicSettings: {},
    showTopics: false,
    pinTopics: false,
  };

  state: State = {
    sceneBuilder: new SceneBuilder(),
    transformsBuilder: new TransformsBuilder(),
    cachedTopicSettings: {},
    editedTopics: [],
    debug: false,
    showTopics: false,
    metadata: {},
    editTipX: undefined,
    editTipY: undefined,
    editTopic: undefined,
    drawingType: null,
    polygonBuilder: new PolygonBuilder(),
    measureInfo: {
      measureState: "idle",
      measurePoints: { start: null, end: null },
    },
    selectedObjects: [],
    clickedPosition: null,
    selectedObject: null,
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    const { frame, cleared, transforms, followTf, selections, topics, topicSettings, currentTime } = nextProps;
    const { sceneBuilder, transformsBuilder, cachedTopicSettings } = prevState;
    if (!frame) {
      return null;
    }

    const newState = { ...prevState };
    if (topicSettings !== cachedTopicSettings) {
      const nonEmptyTopicSettingsKeys = Object.keys(topicSettings).filter(
        (settingKey) => Object.keys(topicSettings[settingKey]).length
      );
      newState.editedTopics = (nonEmptyTopicSettingsKeys: string[]);
      newState.cachedTopicSettings = topicSettings;
    }

    if (cleared) {
      sceneBuilder.clear();
    }
    const rootTfID = transforms.rootOfTransform(
      followTf || getGlobalHooks().perPanelHooks().ThreeDimensionalViz.rootTransformFrame
    ).id;
    sceneBuilder.setTransforms(transforms, rootTfID);
    sceneBuilder.setFlattenMarkers(selections.extensions.includes("Car.flattenMarkers"));
    // toggle scene builder namespaces based on selected namespace nodes in the tree
    sceneBuilder.setEnabledNamespaces(selections.namespaces);
    sceneBuilder.setTopicSettings(topicSettings);

    // toggle scene builder topics based on selected topic nodes in the tree
    const topicsByName = topicsByTopicName(topics);
    sceneBuilder.setTopics(selections.topics.map((name) => topicsByName[name]).filter(Boolean));
    sceneBuilder.setGlobalData(nextProps.globalData);
    sceneBuilder.setFrame(frame);
    sceneBuilder.setCurrentTime(currentTime);
    sceneBuilder.render();

    // Update the transforms and set the selected ones to render.
    transformsBuilder.setTransforms(transforms, rootTfID);
    transformsBuilder.setSelectedTransforms(selections.extensions);

    const metadata = getGlobalHooks()
      .perPanelHooks()
      .ThreeDimensionalViz.getMetadata(frame);
    if (metadata) {
      newState.metadata = metadata;
    }
    return newState;
  }

  onDoubleClick = (ev: MouseEvent, args: ?ReglClickInfo) => {
    this._handleEvent("onDoubleClick", ev, args);
  };
  onMouseDown = (ev: MouseEvent, args: ?ReglClickInfo) => {
    this._handleEvent("onMouseDown", ev, args);
  };
  onMouseMove = (ev: MouseEvent, args: ?ReglClickInfo) => {
    this._handleEvent("onMouseMove", ev, args);
  };
  onMouseUp = (ev: MouseEvent, args: ?ReglClickInfo) => {
    this._handleEvent("onMouseUp", ev, args);
  };
  _updateLinkedGlobalVariables = ({ object }: MouseEventObject) => {
    const { linkedGlobalVariables, setGlobalData } = this.props;
    const interactionData = this._getInteractionData();
    const objectTopic = interactionData && interactionData.topic;
    if (!linkedGlobalVariables.length || !objectTopic) {
      return;
    }
    const newGlobalVariables = {};
    linkedGlobalVariables.forEach(({ topic, markerKeyPath, name }) => {
      if (objectTopic === topic) {
        const objectForPath = get(object, [...markerKeyPath].reverse());
        newGlobalVariables[name] = objectForPath;
      }
    });
    setGlobalData(newGlobalVariables);
  };

  onClick = (event: MouseEvent, args: ?ReglClickInfo) => {
    const selectedObjects = (args && args.objects) || [];
    const clickedPosition = { clientX: event.clientX, clientY: event.clientY };
    if (selectedObjects.length === 0) {
      // unset all
      this.setState({ selectedObjects, selectedObject: null, clickedPosition: null });
    } else if (selectedObjects.length === 1) {
      // select the object directly if there is only one
      const selectedObject = selectedObjects[0];
      this.setState({
        selectedObjects: null,
        selectedObject,
        clickedPosition: null,
      });
      this._updateLinkedGlobalVariables(selectedObject);
    } else {
      // open up context menu to select one object to show details
      this.setState({ selectedObjects, selectedObject: null, clickedPosition });
    }
  };

  _onSelectObject = (selectedObject) => {
    this.setState({ selectedObjects: null, selectedObject });
    this._updateLinkedGlobalVariables(selectedObject);
  };

  _handleDrawPolygons = (eventName: EventName, ev: MouseEvent, args: ?ReglClickInfo) => {
    this.state.polygonBuilder[eventName](ev, args);
    this.forceUpdate();
  };

  _handleEvent = (eventName: EventName, ev: MouseEvent, args: ?ReglClickInfo) => {
    const { drawingType } = this.state;
    if (!args) {
      return;
    }
    // $FlowFixMe
    const measuringHandler = this.measuringTool && this.measuringTool[eventName];
    const measureActive = this.measuringTool && this.measuringTool.measureActive;

    if (measuringHandler && measureActive) {
      return measuringHandler(ev, args);
    } else if (drawingType === DRAWING_CONFIG.Polygons.type) {
      this._handleDrawPolygons(eventName, ev, args);
    }
  };

  keyDownHandlers = {
    "3": () => {
      this.toggleCameraMode();
    },
    [DRAWING_CONFIG.Polygons.key]: () => {
      this._toggleDrawing(DRAWING_CONFIG.Polygons.type);
    },
    [DRAWING_CONFIG.Camera.key]: () => {
      this._toggleDrawing(DRAWING_CONFIG.Camera.type);
    },
    Escape: () => {
      this._exitDrawing();
    },
  };

  _toggleDrawing = (drawingType: DrawingType) => {
    const newDrawingType = this.state.drawingType === drawingType ? null : drawingType;
    this.setState({ drawingType: newDrawingType });
    if (drawingType !== DRAWING_CONFIG.Camera.type) {
      this.switchTo2DCameraIfNeeded();
    }
  };

  _exitDrawing = () => {
    this.setState({ drawingType: null });
  };

  switchTo2DCameraIfNeeded = () => {
    const {
      cameraState,
      cameraState: { perspective },
      saveConfig,
    } = this.props;
    if (this.state.drawingType && perspective) {
      saveConfig({ cameraState: { ...cameraState, perspective: false } });
    }
  };

  toggleCameraMode = () => {
    const { cameraState, saveConfig } = this.props;
    saveConfig({ cameraState: { ...cameraState, perspective: !cameraState.perspective } });
    if (this.measuringTool && cameraState.perspective) {
      this.measuringTool.reset();
    }
  };

  toggleShowTopics = () => {
    const { showTopics } = this.state;
    this.setState({ showTopics: !showTopics });
  };

  toggleDebug = () => {
    this.setState({ debug: !this.state.debug });
  };
  // clicking on the body should hide any edit tip
  onEditClick = (e: SyntheticMouseEvent<HTMLElement>, topic: string) => {
    const { topics } = this.props;
    // if the same icon is clicked again, close the popup
    const existingEditTopic = this.state.editTopic ? this.state.editTopic.name : undefined;
    if (topic === existingEditTopic) {
      return this.setState({
        editTipX: 0,
        editTipY: 0,
        editTopic: undefined,
      });
    }
    const { el } = this;

    // satisfy flow
    if (!el) {
      return;
    }

    const panelRect = el.getBoundingClientRect();
    const editBtnRect = e.currentTarget.getBoundingClientRect();
    const editTopic = topics.find((t) => t.name === topic);
    if (!editTopic) {
      return;
    }
    this.setState({
      editTipX: editBtnRect.right - panelRect.left + 5,
      editTipY: editBtnRect.top + editBtnRect.height / 2,
      editTopic,
    });
  };

  onSettingsChange = (settings: {}) => {
    const { saveConfig, topicSettings } = this.props;
    const { editTopic } = this.state;
    if (!editTopic) {
      return;
    }
    saveConfig({
      topicSettings: {
        ...topicSettings,
        [editTopic.name]: settings,
      },
    });
  };

  onControlsOverlayClick = (e: SyntheticMouseEvent<HTMLDivElement>) => {
    // statisfy flow
    const { el } = this;
    if (!el) {
      return;
    }
    const target = ((e.target: any): HTMLElement);
    // don't close if the click target is outside the panel
    // e.g. don't close when dropdown menus rendered in portals are clicked
    if (!el.contains(target)) {
      return;
    }
    this.setState({ showTopics: false });
  };

  cancelClick = (e: SyntheticMouseEvent<HTMLDivElement>) => {
    // stop the event from bubbling up to onControlsOverlayClick
    // (but don't preventDefault because checkboxes, buttons, etc. should continue to work)
    e.stopPropagation();
  };

  onClearSelectedObject = () => {
    this.setState({ selectedObject: null });
  };

  onSetPolygons = (polygons) => this.setState({ polygonBuilder: new PolygonBuilder(polygons) });

  setType = (newDrawingType) => this.setState({ drawingType: newDrawingType });

  _getInteractionData = (): ?InteractionData => {
    if (this.state.selectedObject) {
      return this.state.selectedObject.object.interactionData;
    }
  };

  renderToolbars() {
    const {
      cameraState,
      cameraState: { perspective },
      followOrientation,
      followTf,
      onAlignXYAxis,
      onCameraStateChange,
      onFollowChange,
      saveConfig,
      selectedPolygonEditFormat,
      showCrosshair,
      transforms,
    } = this.props;
    const { measureInfo, debug, polygonBuilder, drawingType, selectedObject } = this.state;

    return (
      <div className={cx(styles.toolbar, styles.right)}>
        <div className={styles.buttons}>
          <FollowTFControl
            transforms={transforms}
            tfToFollow={followTf ? followTf : undefined}
            followingOrientation={followOrientation}
            onFollowChange={onFollowChange}
          />
        </div>
        <MainToolbar
          measureInfo={measureInfo}
          measuringTool={this.measuringTool}
          perspective={perspective}
          debug={debug}
          onToggleCameraMode={this.toggleCameraMode}
          onToggleDebug={this.toggleDebug}
        />
        {this.measuringTool && this.measuringTool.measureDistance}
        <Interactions
          interactionData={this._getInteractionData()}
          onClearSelectedObject={this.onClearSelectedObject}
          selectedObject={selectedObject}
        />
        <DrawingTools
          // Save some unnecessary re-renders by not passing in the constantly changing cameraState unless it's needed
          cameraState={drawingType === DRAWING_CONFIG.Camera.type ? cameraState : null}
          followOrientation={followOrientation}
          followTf={followTf}
          onAlignXYAxis={onAlignXYAxis}
          onCameraStateChange={onCameraStateChange}
          onSetPolygons={this.onSetPolygons}
          polygonBuilder={polygonBuilder}
          saveConfig={saveConfig}
          selectedPolygonEditFormat={selectedPolygonEditFormat}
          setType={this.setType}
          showCrosshair={!!showCrosshair}
          type={drawingType}
        />
      </div>
    );
  }

  render3d() {
    const {
      sceneBuilder,
      transformsBuilder,
      debug,
      metadata,
      polygonBuilder,
      selectedObject,
      selectedObjects,
      clickedPosition,
    } = this.state;
    const scene = sceneBuilder.getScene();
    const { autoTextBackgroundColor, extensions, cameraState, onCameraStateChange, children, selections } = this.props;

    const WorldComponent = getGlobalHooks().perPanelHooks().ThreeDimensionalViz.WorldComponent;
    // TODO(Audrey): update DrawPolygons to support custom key so the users don't have to press ctrl key all the time

    return (
      <WorldComponent
        selectedObject={selectedObject}
        autoTextBackgroundColor={!!autoTextBackgroundColor}
        cameraState={cameraState}
        debug={debug}
        markerProviders={extensions.markerProviders.concat([sceneBuilder, this.measuringTool, transformsBuilder, this])}
        onCameraStateChange={onCameraStateChange}
        onDoubleClick={this.onDoubleClick}
        onClick={this.onClick}
        onMouseDown={this.onMouseDown}
        onMouseMove={this.onMouseMove}
        onMouseUp={this.onMouseUp}
        scene={scene}
        extensions={selections.extensions}
        metadata={metadata}>
        {children}
        <DrawPolygons>{polygonBuilder.polygons}</DrawPolygons>
        {selectedObjects && clickedPosition && (
          <InteractionContextMenu
            selectedObjects={selectedObjects}
            clickedPosition={clickedPosition}
            onSelectObject={this._onSelectObject}
          />
        )}
        {process.env.NODE_ENV !== "production" && !inScreenshotTests() && <DebugStats />}
      </WorldComponent>
    );
  }

  // draw a crosshair to show the center of the viewport
  renderMarkers(add: MarkerCollector) {
    const { cameraState, showCrosshair } = this.props;
    if (!cameraState || cameraState.perspective || !showCrosshair) {
      return;
    }

    const { target, targetOffset, distance, thetaOffset } = cameraState;
    const targetHeading = cameraStateSelectors.targetHeading(cameraState);

    // move the crosshair to the center of the camera's viewport: the target + targetOffset rotated by heading
    const crosshairPoint = [0, 0, 0];
    vec3.add(crosshairPoint, vec3.rotateZ(crosshairPoint, targetOffset, [0, 0, 0], -targetHeading), target);

    // orient and size the crosshair so it remains visually fixed in the center
    const length = 0.02 * distance;
    const orientation = [0, 0, 0, 1];
    const theta = targetHeading + thetaOffset;

    quat.rotateZ(orientation, orientation, -theta);

    const crosshair = (z, extraThickness) => {
      const thickness = 0.004 * distance * (1 + extraThickness);
      return {
        header: { frame_id: getGlobalHooks().rootTransformFrame, stamp: { sec: 0, nsec: 0 } },
        type: 5,
        action: 0,
        id: "",
        ns: "",
        pose: {
          position: { x: crosshairPoint[0], y: crosshairPoint[1], z },
          orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
        },
        points: [
          { x: -length * (1 + 0.1 * extraThickness), y: 0, z: 0 },
          { x: length * (1 + 0.1 * extraThickness), y: 0, z: 0 },
          { x: 0, y: -length * (1 + 0.1 * extraThickness), z: 0 },
          { x: 0, y: length * (1 + 0.1 * extraThickness), z: 0 },
        ],
        scale: { x: thickness, y: thickness, z: thickness },
      };
    };

    add.lineList({
      ...crosshair(1000, 0.6),
      color: { r: 0, g: 0, b: 0, a: 1 },
    });

    add.lineList({
      ...crosshair(1001, 0),
      color: { r: 1, g: 1, b: 1, a: 1 },
    });
  }

  renderTopicSettingsEditor() {
    const { topicSettings } = this.props;
    const { editTopic, editTipX, editTipY, sceneBuilder } = this.state;
    if (!editTopic || !editTipX || !editTipY) {
      return null;
    }
    // satisfy flow
    const collector = sceneBuilder.collectors[editTopic.name];
    const message = collector ? collector.getMessages()[0] : undefined;

    // need to place the draggable div into an absolute positioned element
    const style = {
      position: "absolute",
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      zIndex: 103,
    };
    const bounds = { left: 0, top: 0 };
    // position the popup to the left and down from the topic selector
    const defaultPosition = { x: editTipX + 30, y: 40 };
    return (
      <div style={style}>
        <Draggable bounds={bounds} defaultPosition={defaultPosition} cancel="input">
          <div className={styles.topicSettingsEditor} onClick={this.cancelClick}>
            <Icon className={styles.closeIcon} onClick={() => this.setState({ editTopic: undefined })}>
              <CloseIcon />
            </Icon>
            <TopicSettingsEditor
              topic={editTopic}
              message={message}
              settings={topicSettings[editTopic.name]}
              onSettingsChange={this.onSettingsChange}
            />
          </div>
        </Draggable>
      </div>
    );
  }

  renderControlsOverlay() {
    const {
      autoTextBackgroundColor,
      checkedNodes,
      expandedNodes,
      modifiedNamespaceTopics,
      pinTopics,
      saveConfig,
      setSelections,
      topics,
      transforms,
    } = this.props;

    const { showTopics, sceneBuilder, editedTopics } = this.state;

    return (
      <TopicSelector
        autoTextBackgroundColor={!!autoTextBackgroundColor}
        namespaces={sceneBuilder.allNamespaces}
        sceneErrors={sceneBuilder.errors}
        showTopics={showTopics || pinTopics}
        topics={topics}
        checkedNodes={checkedNodes}
        editedTopics={editedTopics}
        canEditDatatype={canEditDatatype}
        expandedNodes={expandedNodes}
        modifiedNamespaceTopics={modifiedNamespaceTopics}
        pinTopics={pinTopics}
        setSelections={setSelections}
        saveConfig={saveConfig}
        transforms={transforms}
        // Because transforms are mutable, we need a key that tells us when to update the component. We use the count of
        // the transforms for this.
        transformsCount={transforms.values().length}
        onEditClick={this.onEditClick}
        onToggleShowClick={this.toggleShowTopics}
      />
    );
  }

  render() {
    const {
      drawingType,
      measureInfo: { measureState, measurePoints },
    } = this.state;
    const measureActive = this.measuringTool && this.measuringTool.measureActive;
    const cursorType = (drawingType && drawingType !== DRAWING_CONFIG.Camera.type) || measureActive ? "crosshair" : "";

    return (
      <div
        className={styles.container}
        ref={(el) => (this.el = el)}
        style={{ cursor: cursorType }}
        onClick={this.onControlsOverlayClick}>
        <MeasuringTool
          ref={(el) => (this.measuringTool = el)}
          measureState={measureState}
          measurePoints={measurePoints}
          onMeasureInfoChange={(measureInfo) => this.setState({ measureInfo })}
        />
        <KeyListener keyDownHandlers={this.keyDownHandlers} />
        <PanelToolbar floating helpContent={this.props.helpContent} />
        <div style={{ visibility: videoRecordingMode() ? "hidden" : "visible" }}>
          {this.renderToolbars()}
          {this.renderControlsOverlay()}
          {this.renderTopicSettingsEditor()}
        </div>
        <div className={styles.world}>{this.render3d()}</div>
      </div>
    );
  }
}

export default function Layout(props: WrapperProps) {
  const { linkedGlobalVariables } = useLinkedGlobalVariables();
  const { globalData, setGlobalData } = useGlobalData();

  return (
    <BaseComponent
      {...props}
      linkedGlobalVariables={linkedGlobalVariables}
      globalData={globalData}
      setGlobalData={setGlobalData}
    />
  );
}
