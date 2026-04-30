import { NextRequest, NextResponse } from "next/server";

const MDAC_CITY_URL = "https://imigresen-online.imi.gov.my/mdac/register?retrieveRefCity&state=";

interface CityOption {
  value: string;
  label: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseOptions(html: string): CityOption[] {
  const pattern = /<option value=['"]([^'"]*)['"](?:[^>]*)>([\s\S]*?)<\/option>/gi;
  const options: CityOption[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const value = match[1]?.trim() ?? "";
    const label = decodeHtml(match[2]?.replace(/\s+/g, " ").trim() ?? "");
    if (!value || !label || label.toLowerCase() === "please choose") continue;
    options.push({ value, label });
  }

  return options;
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state")?.trim();
  if (!state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  try {
    const response = await fetch(`${MDAC_CITY_URL}${encodeURIComponent(state)}`, {
      headers: {
        "User-Agent": "mdac-better/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`MDAC returned ${response.status}`);
    }

    const html = await response.text();
    const cities = parseOptions(html);
    return NextResponse.json({ cities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load MDAC cities: ${message}` },
      { status: 502 }
    );
  }
}
