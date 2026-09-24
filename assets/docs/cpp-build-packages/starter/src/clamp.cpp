#include "lesson/clamp.hpp"
#include <stdexcept>
int clamp_value(int value, int low, int high) {
    if (low > high) throw std::invalid_argument("low must not exceed high");
    if (value < low) return low;
    if (value > high) return high;
    return value;
}
