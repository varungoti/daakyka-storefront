import { testimonialAvatars } from "@/data/media/catalog";
import type { Testimonial } from "@/lib/types";

export const testimonials: Testimonial[] = [
  {
    id: "1",
    quote:
      "The softest, most comfortable scrubs I've ever worn. The 4-way stretch is a game changer during 12 hour shifts!",
    name: "Dr. Amanda Lee",
    title: "Emergency Physician",
    rating: 5,
    avatar: testimonialAvatars.amanda,
  },
  {
    id: "2",
    quote:
      "Finally scrubs that look professional and feel premium. The liquid repellent fabric has saved me more than once.",
    name: "Nurse Priya Sharma",
    title: "ICU Nurse",
    rating: 5,
    avatar: testimonialAvatars.priya,
  },
  {
    id: "3",
    quote:
      "Our hospital ordered bespoke sets for the entire surgical team. The quality and fit consistency were outstanding.",
    name: "Dr. Marcus Chen",
    title: "Chief of Surgery",
    rating: 5,
    avatar: testimonialAvatars.marcus,
  },
  {
    id: "4",
    quote:
      "I love the mix and match builder — being able to customize my set with embroidery makes it truly mine.",
    name: "Dr. Sarah Okonkwo",
    title: "Pediatrician",
    rating: 5,
    avatar: testimonialAvatars.sarah,
  },
];
