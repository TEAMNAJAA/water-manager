// NamJai Clip camera hood – parametric. Measure your meter and set meter_d.
// Units: mm. Print in PETG or ASA (UV resistant), 3 walls, 25 % infill, no supports.

part = "hood";        // "hood" or "test_ring"

meter_d   = 105;      // outside diameter of the meter top where the collar sits
collar_h  = 18;       // collar height around the meter top
clearance = 0.6;      // gap between collar and meter
hood_h    = 75;       // lens-to-glass distance; check the camera focus on your meter
wall      = 2.4;

plate     = 64;       // square plate screwed to the enclosure lid
cam_hole  = 22;       // window for the ESP32-CAM lens
screw_d   = 3.4;
screw_in  = 6;

led_d     = 5.3;      // 5 mm LED
led_boss  = 16;       // boss length along the LED axis
slot_t    = 1.3;      // slot for a 1 mm translucent diffuser sheet
clamp_w   = 9.5;      // groove for a hose clamp around the collar
drain_d   = 2.5;
lip_w     = 4;        // ledge that rests on the meter rim
lip_t     = 2;

$fn = 96;

rb = meter_d / 2 + clearance + wall;          // outer radius at the collar
rt = plate / 2;                                // outer "radius" at the plate
z0 = collar_h;                                 // glass level
dz45 = rb / (1 + (rb - rt) / hood_h);          // height where a 45° ray hits the glass centre
r45 = rb - (rb - rt) * dz45 / hood_h;

module shell(off) {
  hull() {
    translate([0, 0, z0]) cylinder(r = rb - off, h = 0.01);
    translate([-(plate / 2 - off), -(plate / 2 - off), z0 + hood_h - 0.01]) cube([plate - 2 * off, plate - 2 * off, 0.01]);
  }
}

module led_boss_at(a) {
  rotate([0, 0, a]) translate([r45 + 1.5, 0, z0 + dz45 + 1.5]) rotate([0, -135, 0]) children();
}

module boss_solid() { translate([0, 0, -led_boss / 2]) cylinder(d = led_d + 2 * wall, h = led_boss); }

module boss_cut() {
  translate([0, 0, -led_boss]) cylinder(d = led_d, h = led_boss * 2);
  translate([-(led_d + 2 * wall), -(led_d / 2 + 1), led_boss / 2 - 3]) cube([led_d + 2 * wall, led_d + 2, slot_t]);
}

module hood() {
  difference() {
    union() {
      difference() { shell(0); shell(wall); }
      translate([-plate / 2, -plate / 2, z0 + hood_h - wall]) cube([plate, plate, wall]);
      cylinder(r = rb, h = z0);
      translate([0, 0, z0]) cylinder(r = rb, h = lip_t);
      for (a = [0, 180]) led_boss_at(a) boss_solid();
    }
    translate([0, 0, -1]) cylinder(r = meter_d / 2 + clearance, h = z0 + 1.01);
    translate([0, 0, z0 - 0.01]) cylinder(r = meter_d / 2 + clearance - lip_w, h = lip_t + 0.02);
    translate([0, 0, z0 + hood_h - wall - 1]) cylinder(d = cam_hole, h = wall + 2);
    for (x = [-1, 1], y = [-1, 1]) translate([x * (plate / 2 - screw_in), y * (plate / 2 - screw_in), z0 + hood_h - wall - 1]) cylinder(d = screw_d, h = wall + 2);
    for (a = [0, 180]) led_boss_at(a) boss_cut();
    for (a = [45, 135, 225, 315]) rotate([0, 0, a]) translate([rb - wall - 1, -0.75, -1]) cube([wall + 2, 1.5, z0 - 3]);
    translate([0, 0, z0 / 2 - clamp_w / 2]) difference() { cylinder(r = rb + 1, h = clamp_w); cylinder(r = rb - 0.8, h = clamp_w); }
    rotate([0, 0, 90]) translate([rb - wall - 1, 0, 2]) rotate([0, 90, 0]) cylinder(d = drain_d, h = wall + 2);
  }
}

module test_ring() {
  difference() { cylinder(r = rb, h = 8); translate([0, 0, -1]) cylinder(r = meter_d / 2 + clearance, h = 10); }
}

if (part == "hood") hood(); else test_ring();
