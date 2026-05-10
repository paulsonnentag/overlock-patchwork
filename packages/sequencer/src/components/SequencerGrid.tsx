import classnames from "classnames";
import { Toggle } from "../datatype";
import { ProgressBar } from "./ProgressBar";
import "../style.css";
import { SongConfig, barCountFromConfig } from "../config";
import type { DiffSets } from "../diff";

interface CellProps {
  toggle: Toggle;
  config: SongConfig;
  x: number;
  y: number;
  isPlaying: boolean;
  songIsPlaying: boolean;
  isDrum: boolean;
  playStartTime: number;
  currentTime: number;
  diff: "added" | "deleted" | null;
  handleToggleChange: (is_toggled: boolean, x: number, y: number) => void;
}

export function Cell({
  toggle,
  config,
  x,
  y,
  isPlaying,
  songIsPlaying,
  isDrum,
  playStartTime,
  currentTime,
  diff,
  handleToggleChange,
}: CellProps) {
  function onClick() {
    handleToggleChange(!toggle.toggled, x, y);
  }
  let rootColor = false;
  let barStart = false;
  if (y % 7 == 0 && !toggle.toggled && !isDrum) {
    rootColor = true;
  }
  if (x % config.stepsPerBar == 0) {
    barStart = true;
  }
  let quarter = false;
  if (x % (config.stepsPerBar / 4) == 0) {
    quarter = true;
  }

  let toggleOnTime = Math.max(playStartTime, toggle.toggleOnTime);
  let age = currentTime - toggleOnTime;
  let showAged = toggle.toggled && songIsPlaying;
  let isNewToggle = showAged && age < 12000;
  let isYoungToggle = showAged && age >= 12000 && age < 24000;
  let isTeenageToggle = showAged && age >= 24000;

  let classes = classnames("cell", {
    "light-vertical": !quarter,
    "cell-on": toggle.toggled,
    "eighth-notes": config.stepsPerBar == 8,
    "sixteenth-notes": config.stepsPerBar == 16,
    "drum-cell": isDrum,
    "root-color": rootColor,
    "bar-start-color": barStart,
    playing: isPlaying,
    "new-toggle": isNewToggle,
    "young-toggle": isYoungToggle,
    "teenage-toggle": isTeenageToggle,
    "diff-added": diff === "added",
    "diff-deleted": diff === "deleted",
  });

  return <button className={classes} onClick={onClick}></button>;
}

interface GridProps {
  toggleRows: Toggle[][];
  drumToggleRows: Toggle[][];
  handleToggleChange: (isToggled: boolean, x: number, y: number) => void;
  handleDrumToggleChange: (isToggled: boolean, x: number, y: number) => void;
  playingIdx: number;
  playStartTime: number;
  isPlaying: boolean;
  config: SongConfig;
  instrumentDiff: DiffSets;
  drumDiff: DiffSets;
}

export function UIGrid({
  toggleRows,
  drumToggleRows,
  handleToggleChange,
  handleDrumToggleChange,
  playingIdx,
  playStartTime,
  isPlaying,
  config,
  instrumentDiff,
  drumDiff,
}: GridProps) {
  let stepCount = barCountFromConfig(config);
  let currentTime = Date.now();
  return (
    <div className="grid-container">
      {toggleRows
        .map((row, y_idx) => {
          return (
            <div className="grid-row" key={y_idx}>
              {row
                .filter((_toggle, x_idx) => {
                  return x_idx < stepCount;
                })
                .map((toggle, x_idx) => {
                  let cellIsPlaying = false;
                  if (x_idx == playingIdx) {
                    cellIsPlaying = true;
                  }
                  let key = "cell:x:" + x_idx + ",y:" + y_idx;
                  let diff = diffStatus(instrumentDiff, y_idx, x_idx);
                  return (
                    <Cell
                      toggle={toggle}
                      config={config}
                      x={x_idx}
                      y={y_idx}
                      handleToggleChange={handleToggleChange}
                      isPlaying={cellIsPlaying}
                      songIsPlaying={isPlaying}
                      isDrum={false}
                      playStartTime={playStartTime}
                      currentTime={currentTime}
                      diff={diff}
                      key={key}
                    ></Cell>
                  );
                })}
            </div>
          );
        })
        .reverse()}
      <div className="progress-row">
        <ProgressBar playingIdx={playingIdx} config={config}></ProgressBar>
      </div>
      {drumToggleRows
        .map((row, y_idx) => {
          return (
            <div className="grid-row" key={"drum:" + y_idx}>
              {row
                .filter((_toggle, x_idx) => {
                  return x_idx < stepCount;
                })
                .map((toggle, x_idx) => {
                  let cellIsPlaying = false;
                  if (x_idx == playingIdx) {
                    cellIsPlaying = true;
                  }
                  let key = "drum-cell:x:" + x_idx + ",y:" + y_idx;
                  let diff = diffStatus(drumDiff, y_idx, x_idx);
                  return (
                    <Cell
                      toggle={toggle}
                      config={config}
                      x={x_idx}
                      y={y_idx}
                      handleToggleChange={handleDrumToggleChange}
                      isPlaying={cellIsPlaying}
                      songIsPlaying={isPlaying}
                      isDrum={true}
                      playStartTime={playStartTime}
                      currentTime={currentTime}
                      diff={diff}
                      key={key}
                    ></Cell>
                  );
                })}
            </div>
          );
        })
        .reverse()}
    </div>
  );
}

function diffStatus(
  diff: DiffSets,
  y: number,
  x: number
): "added" | "deleted" | null {
  const key = `${y}:${x}`;
  if (diff.added.has(key)) return "added";
  if (diff.deleted.has(key)) return "deleted";
  return null;
}
