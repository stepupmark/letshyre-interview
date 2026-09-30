import { fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { GetHelp } from "./GetHelp";
import commonEn from "@/i18n/locales/en/common.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { common: commonEn } },
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  delete window.electronAPI;
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Get help" }));

describe("GetHelp", () => {
  it("opens in the page with answers and no reference code", () => {
    render(<GetHelp />);
    open();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Camera problems");
    expect(dialog).toHaveTextContent("Connection problems");
    expect(dialog).toHaveTextContent("Display problems");
    expect(dialog).not.toHaveTextContent(/Reference code|LH-/);
    expect(dialog.querySelector("a")).toBeNull();
    expect(screen.queryByText("Contact support")).not.toBeInTheDocument();
  });

  it("shows the desktop app's support contact as text", async () => {
    window.electronAPI = {
      getSupportContact: vi.fn().mockResolvedValue({ email: "help@example.com", url: "" }),
    };
    render(<GetHelp />);
    open();

    expect(await screen.findByText("help@example.com")).toBeInTheDocument();
    expect(screen.getByText("Contact support")).toBeInTheDocument();
    expect(screen.queryByText(/Website/)).not.toBeInTheDocument();
  });

  it("closes again", () => {
    render(<GetHelp />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
