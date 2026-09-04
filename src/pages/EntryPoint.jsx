import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

// Entry point at "/": extracts ac/rc tokens from the URL into sessionStorage,
// then immediately redirects to /interview. The PrivateRoute loader gates
// /interview behind token presence, so landing here without tokens ends up
// at /unauthorized-access.
export function EntryPoint() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  useEffect(() => {
    const ac = searchParams.get("ac");
    const rc = searchParams.get("rc");

    if (ac) sessionStorage.setItem("ac", ac);
    if (rc) sessionStorage.setItem("rc", rc);

    navigate("/interview", { replace: true });
  }, [searchParams, navigate]);

  return null;
}
