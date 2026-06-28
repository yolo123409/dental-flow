export default function Navbar() {
  return (
    <nav className="flex items-center justify-between px-10 py-6 border-b bg-white">
      <h1 className="text-2xl font-bold text-blue-600">
        Dental Flow
      </h1>

      <div className="flex gap-8">
        <a href="#" className="hover:text-blue-600">
          Home
        </a>

        <a href="#" className="hover:text-blue-600">
          AI Systems
        </a>

        <a href="#" className="hover:text-blue-600">
          Pricing
        </a>

        <a href="#" className="hover:text-blue-600">
          Contact
        </a>
      </div>

      <button className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">
        Login
      </button>
    </nav>
  );
}