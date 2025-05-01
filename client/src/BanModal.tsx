import React, { useMemo, useState } from "react";
import { banAtom } from "./globals.ts";
import { REGIONS, ServerInfo } from "./types.ts";
import { api } from "./utils.ts";
import "./BanModal.css";
import { Modal } from "./Modal.tsx";

interface BanModalProps {
  serverToBan: ServerInfo;
}

export const BanModal = ({ serverToBan }: BanModalProps) => {
  const [error, setError] = useState<string>("");

  const reason = useMemo(() => {
    const map = serverToBan.map?.toLowerCase() ?? "";
    const [prefix] = map.split("_");
    const name = serverToBan.name.toLowerCase();

    if (["achievement", "trade", "idle"].includes(prefix)) {
      return "social";
    }
    if (
      prefix === "mge" ||
      name.includes("soapdm") ||
      prefix === "dm" ||
      name.includes("duel")
    ) {
      return "dm";
    }
    if (prefix === "mvm") {
      return "mvm";
    }
    if (
      map.startsWith("z") ||
      [
        "vsh",
        "par",
        "pf",
        "rpg",
        "rf2",
        "ba",
        "jb",
        "jail",
        "tfdb",
        "slender",
        "td",
        "dr",
      ].includes(prefix) ||
      name.includes("prop") ||
      name.includes("one thousand uncle") ||
      name.includes("x10") ||
      name.includes("x5") ||
      name.includes("x-1")
    ) {
      return "gamemode";
    }
    if (
      map.includes("fort") ||
      map.includes("high") ||
      map.includes("turbine") ||
      map.includes("orange") ||
      map.includes("dustbowl")
    ) {
      return "24/7";
    }
    if (prefix === "tr") {
      return "other";
    }
    if (["jump", "rj", "kz", "bhop", "surf"].includes(prefix)) {
      return "jump/surf";
    }
  }, [serverToBan]);

  return (
    <Modal
      onClose={() => {
        banAtom.value = undefined;
      }}
    >
      <div className="modal ban-modal">
        <div>Ban Modal</div>
        <div className="serverinfo right-align">
          <label>
            IP <input type="text" disabled value={serverToBan.server} />
          </label>
          <label>
            Name <input type="text" disabled value={serverToBan.name} />
          </label>
          <label>
            Map <input type="text" disabled value={serverToBan.map} />
          </label>
          <label>
            Region
            <input type="text" disabled value={REGIONS[serverToBan.regions]} />
          </label>
          <label>
            Keywords
            <input
              type="text"
              title={serverToBan.keywords}
              disabled
              value={serverToBan.keywords}
            />
          </label>
        </div>
        <hr />
        <form
          className="right-align"
          onSubmit={async (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const reason = formData.get("reason");
            try {
              await api("/api/ban", {
                method: "POST",
                body: { ip: serverToBan.ip, reason },
              });
              banAtom.value = undefined;
            } catch (e) {
              if (e instanceof Error) {
                setError(e.message);
              } else {
                console.error(e);
              }
            }
            return;
          }}
        >
          <label>
            Reason
            <select name="reason" defaultValue={reason}>
              <option value=""></option>
              <option value="vanilla">Vanilla</option>
              <option value="24/7">24/7 Server</option>
              <option value="comp">Comp</option>
              <option value="dm">DM</option>
              <option value="fastpath">Fastpath</option>
              <option value="gamemode">Gamemode</option>
              <option value="jump/surf">Jump/Surf</option>
              <option value="mvm">MVM</option>
              <option value="social">Social</option>

              <option value="other">Other</option>
              <option value="fake players">Fake players</option>
            </select>
          </label>
          <div className="error">{error}</div>
          <button type="submit" ref={(btn) => btn?.focus()}>
            Ban
          </button>
        </form>
      </div>
    </Modal>
  );
};
