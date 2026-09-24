#include "lesson/clamp.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>
int main() {
    int failures = 0;
    const auto check = [&failures](bool passed, const char* message) {
        if (!passed) { std::cerr << message << '\n'; ++failures; }
    };
    check(clamp_value(5, 0, 10) == 5, "inside range");
    check(clamp_value(-1, 0, 10) == 0, "below range");
    check(clamp_value(12, 0, 10) == 10, "above range");
    check(clamp_value(0, 0, 10) == 0, "lower boundary");
    check(clamp_value(10, 0, 10) == 10, "upper boundary");
    check(clamp_value(99, 7, 7) == 7, "single value range");
    check(clamp_value(std::numeric_limits<int>::min(), -10, 10) == -10, "minimum int");
    check(clamp_value(std::numeric_limits<int>::max(), -10, 10) == 10, "maximum int");
    bool rejected = false;
    try { (void)clamp_value(5, 10, 0); }
    catch (const std::invalid_argument&) { rejected = true; }
    check(rejected, "reversed range must throw");
    return failures == 0 ? 0 : 1;
}
