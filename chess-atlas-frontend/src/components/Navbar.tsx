import { NavLink } from 'react-router-dom';

function Navbar() {
  return (
    <nav className="navbar">
      <span className="navbar-brand">Chess Atlas</span>
      <div className="navbar-links">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
        >
          Analyzer
        </NavLink>
        <NavLink
          to="/explorer"
          className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
        >
          Explorer
        </NavLink>
      </div>
    </nav>
  );
}

export default Navbar;
