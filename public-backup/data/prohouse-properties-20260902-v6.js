/*
PROHOUSE PROPERTY DATABASE
Duplicate a property object to add another location.
*/
window.PROHOUSE_PROPERTIES = [
  {
    id: "wolli-creek",
    name: "ProHouse – Sydney Airport Wolli Creek",
    shortName: "Wolli Creek",
    status: "active",
    suburb: "Wolli Creek",
    state: "NSW",
    locationLabel: "Sydney Airport · Wolli Creek",
    summary: "Convenient furnished accommodation near Wolli Creek Station with practical access to Sydney Airport and Sydney CBD.",
    description: "A convenient Sydney base for short stays, airport travel, business trips, relocation and longer furnished stays.",
    heroImage: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=88",
    cardImage: "https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1200&q=86",
    bookingUrl: "/book",
    highlights: [
      "Convenient access to Sydney Airport",
      "Near Wolli Creek Station",
      "Shops, cafés and dining nearby",
      "Self check-in",
      "Furnished accommodation"
    ],
    notes: "Exact address and access instructions are provided with the confirmed booking and arrival guide.",
    offers: [
      {
        id: "room-a",
        name: "Room A",
        type: "Private room",
        shared: true,
        summary: "Private bedroom in a shared 3-bedroom apartment.",
        image: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1000&q=86",
        details: ["Private bedroom", "Shared kitchen and living area", "Self check-in"]
      },
      {
        id: "room-b",
        name: "Room B",
        type: "Private room",
        shared: true,
        summary: "Private bedroom in a shared 3-bedroom apartment.",
        image: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1000&q=86",
        details: ["Private bedroom", "Shared kitchen and living area", "Self check-in"]
      },
      {
        id: "room-c",
        name: "Room C",
        type: "Private room",
        shared: true,
        summary: "Private bedroom in a shared 3-bedroom apartment.",
        image: "https://images.unsplash.com/photo-1615874959474-d609969a20ed?auto=format&fit=crop&w=1000&q=86",
        details: ["Private bedroom", "Shared kitchen and living area", "Self check-in"]
      },
      {
        id: "whole-apartment",
        name: "3 Bedroom Whole Apartment",
        type: "Whole apartment",
        shared: false,
        summary: "A furnished 3-bedroom apartment for your booking's exclusive use, subject to availability.",
        image: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1000&q=86",
        details: ["Whole apartment", "Furnished living areas", "Kitchen facilities"]
      }
    ]
  },
  {
    id: "sydney-cbd",
    name: "ProHouse – Sydney CBD",
    shortName: "Sydney CBD",
    status: "active",
    suburb: "Sydney CBD",
    state: "NSW",
    locationLabel: "Sydney CBD · NSW",
    summary: "Furnished city accommodation positioned for business trips, relocations and convenient access to central Sydney.",
    description: "Sample property — details and availability to be confirmed before publishing as a live accommodation offering.",
    heroImage: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=1600&q=88",
    cardImage: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=1200&q=86",
    bookingUrl: "/book",
    highlights: ["Central Sydney location", "Furnished accommodation", "Flexible stays"],
    notes: "Sample property for website layout.",
    offers: []
  },
  {
    id: "melbourne-st-albans",
    name: "ProHouse – Melbourne St Albans",
    shortName: "St Albans",
    status: "active",
    suburb: "St Albans",
    state: "VIC",
    locationLabel: "St Albans · Melbourne",
    summary: "Comfortable furnished accommodation for short stays, work assignments and relocations in Melbourne’s west.",
    description: "Sample property — details and availability to be confirmed before publishing as a live accommodation offering.",
    heroImage: "https://images.unsplash.com/photo-1514395462725-fb4566210144?auto=format&fit=crop&w=1600&q=88",
    cardImage: "https://images.unsplash.com/photo-1514395462725-fb4566210144?auto=format&fit=crop&w=1200&q=86",
    bookingUrl: "/book",
    highlights: ["Melbourne west", "Furnished accommodation", "Flexible stays"],
    notes: "Sample property for website layout.",
    offers: []
  },
  {
    id: "melbourne-cbd",
    name: "ProHouse – Melbourne CBD",
    shortName: "Melbourne CBD",
    status: "active",
    suburb: "Melbourne CBD",
    state: "VIC",
    locationLabel: "Melbourne CBD · VIC",
    summary: "Furnished city accommodation designed for business travel, relocation and flexible stays in central Melbourne.",
    description: "Sample property — details and availability to be confirmed before publishing as a live accommodation offering.",
    heroImage: "https://images.unsplash.com/photo-1514395462725-fb4566210144?auto=format&fit=crop&w=1600&q=88",
    cardImage: "https://images.unsplash.com/photo-1514395462725-fb4566210144?auto=format&fit=crop&w=1200&q=86",
    bookingUrl: "/book",
    highlights: ["Central Melbourne", "Furnished accommodation", "Flexible stays"],
    notes: "Sample property for website layout.",
    offers: []
  },
  {
    id: "perth-cbd",
    name: "ProHouse – Perth CBD",
    shortName: "Perth CBD",
    status: "active",
    suburb: "Perth CBD",
    state: "WA",
    locationLabel: "Perth CBD · WA",
    summary: "Modern furnished accommodation for corporate travellers, relocations and flexible stays in central Perth.",
    description: "Sample property — details and availability to be confirmed before publishing as a live accommodation offering.",
    heroImage: "https://images.unsplash.com/photo-1524586410818-196d249560e4?auto=format&fit=crop&w=1600&q=88",
    cardImage: "https://images.unsplash.com/photo-1524586410818-196d249560e4?auto=format&fit=crop&w=1200&q=86",
    bookingUrl: "/book",
    highlights: ["Central Perth", "Furnished accommodation", "Flexible stays"],
    notes: "Sample property for website layout.",
    offers: []
  },
  {
    id: "canberra-cbd",
    name: "ProHouse – Canberra",
    shortName: "Canberra",
    status: "active",
    suburb: "Canberra",
    state: "ACT",
    locationLabel: "Canberra · ACT",
    summary: "Furnished accommodation for government, corporate, relocation and flexible stays in Canberra.",
    description: "Sample property — details and availability to be confirmed before publishing as a live accommodation offering.",
    heroImage: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lake-ParlHouse.JPG",
    cardImage: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lake-ParlHouse.JPG",
    bookingUrl: "/book",
    highlights: ["Canberra", "Furnished accommodation", "Flexible stays"],
    notes: "Sample property for website layout.",
    offers: []
  }
];