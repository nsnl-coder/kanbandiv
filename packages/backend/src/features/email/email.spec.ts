import { describe, expect, it } from "vitest";
import { esc, otpTemplate } from "./email.service.js";

describe("email templates", () => {
  it("renders the OTP code into the HTML", () => {
    const html = otpTemplate("Verify your email", "Use this code:", "123456");
    expect(html).toContain("123456");
    expect(html).toMatch(/<html/i);
  });

  it("escapes HTML metacharacters in interpolated values", () => {
    const html = otpTemplate("<script>x</script>", "a & b", "000000");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });
});

describe("esc", () => {
  it("escapes &, <, >, and \"", () => {
    expect(esc(`& < > "`)).toBe("&amp; &lt; &gt; &quot;");
  });

  it("leaves plain text untouched", () => {
    expect(esc("hello world 123")).toBe("hello world 123");
  });
});
