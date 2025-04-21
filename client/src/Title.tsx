import { Link, useLocation } from "react-router";

export const Title = () => {
  const location = useLocation();
  const useH1 = location.pathname === "/";

  const brand = (
    <Link to="/" className="brand">
      serverbrowser.tf
    </Link>
  );
  if (useH1) {
    return <h1 className="brand-title">{brand}</h1>;
  }
  return <span className="brand-title">{brand}</span>;
};
