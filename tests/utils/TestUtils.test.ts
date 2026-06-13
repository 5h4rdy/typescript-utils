import TestUtils from "../../src/utils/TestUtils";

describe("TestUtils", () => {

    describe("getRandomName", () => {
        it("returns a name with exactly one space (two words)", () => {
            const name = TestUtils.getRandomName();
            const parts = name.split(" ");
            expect(parts.length).toBe(2);
            expect(parts[0].length).toBeGreaterThan(0);
            expect(parts[1].length).toBeGreaterThan(0);
        });

        it("returns different names on successive calls (statistical)", () => {
            const names = new Set<string>();
            for (let i = 0; i < 50; i++) {
                names.add(TestUtils.getRandomName());
            }
            // With 100+ first names and 100+ surnames, 50 draws should yield many unique values
            expect(names.size).toBeGreaterThan(10);
        });
    });

    describe("getRandomWords", () => {
        it("returns the requested number of words", () => {
            const result = TestUtils.getRandomWords(5);
            const words = result.split(" ");
            expect(words.length).toBe(5);
        });

        it("returns a single word by default", () => {
            const result = TestUtils.getRandomWords();
            expect(result.split(" ").length).toBe(1);
        });
    });

    describe("generateRandomEmail", () => {
        it("generates a valid-looking email", () => {
            const email = TestUtils.generateRandomEmail();
            // Should contain an @ and a domain from domainNames
            expect(email).toContain("@");
            expect(email.split("@").length).toBe(2);
        });
    });

    describe("getInitials", () => {
        it("returns the correct initials for a two-word string", () => {
            expect(TestUtils.getInitials("John Smith")).toBe("JS");
        });

        it("returns an error message for non-two-word strings", () => {
            expect(TestUtils.getInitials("John")).toContain("exactly 2 words");
            expect(TestUtils.getInitials("John Jacob Smith")).toContain("exactly 2 words");
        });
    });

    describe("getRandomDate", () => {
        it("returns a Date within the given range", () => {
            const start = new Date(2020, 0, 1);
            const end = new Date(2020, 11, 31);
            const result = TestUtils.getRandomDate(start, end);

            expect(result.getTime()).toBeGreaterThanOrEqual(start.getTime());
            expect(result.getTime()).toBeLessThanOrEqual(end.getTime());
        });

        it("returns a Date within the default range when no args", () => {
            const result = TestUtils.getRandomDate();
            expect(result).toBeInstanceOf(Date);
            // Default is ~100 years ago to ~1 year ahead
            const now = Date.now();
            expect(result.getTime()).toBeLessThan(now + 1000 * 86400 * 400);
        });

        it("throws if only one boundary is provided", () => {
            expect(() => TestUtils.getRandomDate(new Date())).toThrow();
        });
    });

    describe("data arrays", () => {
        it("firstnames is non-empty and contains strings", () => {
            expect(TestUtils.firstnames.length).toBeGreaterThan(50);
            TestUtils.firstnames.forEach(n => expect(typeof n).toBe("string"));
        });

        it("surnames is non-empty and contains strings", () => {
            expect(TestUtils.surnames.length).toBeGreaterThan(50);
            TestUtils.surnames.forEach(n => expect(typeof n).toBe("string"));
        });

        it("domainNames is non-empty", () => {
            expect(TestUtils.domainNames.length).toBeGreaterThan(0);
        });

        it("randomWordsArray is non-empty", () => {
            expect(TestUtils.randomWordsArray.length).toBeGreaterThan(0);
        });

        it("repairProducts is non-empty", () => {
            expect(TestUtils.repairProducts.length).toBeGreaterThan(0);
        });
    });
});
