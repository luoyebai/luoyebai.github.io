#ifndef LESSON_CLAMP_HPP
#define LESSON_CLAMP_HPP
// Clamp value to [low, high]. Throws std::invalid_argument if low > high.
int clamp_value(int value, int low, int high);
#endif
