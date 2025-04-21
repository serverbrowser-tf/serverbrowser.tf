import { useDeferredValue, useEffect, useState } from "react";
import cx from "classnames";
import { Link, useLocation } from "react-router";
import { Atom, loggedInAtom, useAtom } from "./globals";
import "./TabsHeader.css";

export type Tab = "server" | "favorites" | "blacklist" | "admin" | "maps";

export const currentTabAtom = new Atom<Tab>("server");
export const currentSearch = new Atom("");

export const TabsHeader = () => {
  const [searchRaw, setSearch] = useState(currentSearch.value);
  const search = useDeferredValue(searchRaw);
  const loggedIn = useAtom(loggedInAtom);
  const location = useLocation();
  let tab: Tab = "server";

  if (location.pathname.startsWith("/favorites")) {
    tab = "favorites";
  } else if (location.pathname.startsWith("/blacklist")) {
    tab = "blacklist";
  } else if (location.pathname.startsWith("/admin-view")) {
    tab = "admin";
  } else if (location.pathname.startsWith("/maps")) {
    tab = "maps";
  }

  useEffect(() => {
    currentTabAtom.value = tab;
  }, [tab]);

  useEffect(() => {
    currentSearch.value = search;
  }, [search]);

  return (
    <div className="tabs-header">
      <Link
        to="/"
        className={cx("tab link-button", tab === "server" && "active")}
        draggable={false}
        replace
      >
        Servers
      </Link>
      <Link
        to="/favorites"
        className={cx("tab link-button", tab === "favorites" && "active")}
        draggable={false}
        replace
      >
        Favorites
      </Link>
      <Link
        to="/blacklist"
        className={cx("tab link-button", tab === "blacklist" && "active")}
        draggable={false}
        replace
      >
        Blacklist
      </Link>
      <Link
        to="/maps"
        className={cx("tab link-button", tab === "maps" && "active")}
        draggable={false}
        replace
      >
        Maps
      </Link>
      {loggedIn && (
        <Link
          to="/admin-view"
          className={cx("tab link-button", tab === "admin" && "active")}
          draggable={false}
          replace
        >
          Admin view
        </Link>
      )}

      <input
        type="text"
        id="search"
        name="search"
        className="search"
        placeholder="search"
        value={searchRaw}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
    </div>
  );
};
