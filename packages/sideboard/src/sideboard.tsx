import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { withDocHandle } from "patchwork-dom";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";

import { filter, setFilter } from "./state.ts";
import { createOpenEvent, type OpenDocumentEventDetail } from "./events.ts";
import { SearchIcon } from "./icons.tsx";
import { DocumentList } from "./document-list/document-list.tsx";
import { handleFilesDrop } from "./document-list/file-drop.ts";

import "./styles.css";

export default withDocHandle<FolderDoc>(({ element, handle, repo }) => {
  const folder = makeDocumentProjection(handle);

  function open(detail: OpenDocumentEventDetail) {
    element.dispatchEvent(createOpenEvent(detail));
  }

  const [isDraggingFile, setIsDraggingFile] = createSignal(false);

  return render(
    () => (
      <aside class="sideboard">
        <div class="sideboard__filter-container sideboard-widget">
          <SearchIcon />
          <input
            name="filter"
            class="sideboard__filter"
            placeholder="Filter by title"
            value={filter()}
            onInput={(event) => setFilter(event.target.value.toLowerCase())}
          />
        </div>
        <nav
          class="sideboard__doclist sideboard-widget"
          classList={{
            "sideboard__doclist--drag-over": isDraggingFile(),
          }}
          role="tree"
          aria-multiselectable="true"
          onDragOver={(event: DragEvent) => {
            // Only handle file drops from OS
            if (event.dataTransfer?.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDraggingFile(true);
            }
          }}
          onDragLeave={(event: DragEvent) => {
            const related = event.relatedTarget as Element;
            if (!related || !(event.currentTarget as Element).contains(related)) {
              setIsDraggingFile(false);
            }
          }}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setIsDraggingFile(false);

            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
              const insertIndex = handle.doc()?.docs?.length || 0;
              handleFilesDrop(files, handle, repo, "inside", insertIndex);
            }
          }}
        >
          <DocumentList
            depth={0}
            repo={repo}
            docs={folder.docs}
            handle={handle}
            open={open}
            selectedDocUrls={[]}
            element={element}
            rootFolderHandle={handle}
          />
        </nav>
      </aside>
    ),
    element
  );
});
