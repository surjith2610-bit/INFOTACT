import React from "react";
import Navbar from "../components/Navbar.jsx";
import SparkHero from "../components/SparkHero.jsx";
import ServicesSection from "../components/ServicesSection.jsx";
import GallerySection from "../components/GallerySection.jsx";
import EnquiryForm from "../components/EnquiryForm.jsx";
import FloatingCTA from "../components/FloatingCTA.jsx";
import Footer from "../components/Footer.jsx";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-orange-500 selection:text-white">
      <Navbar />
      <SparkHero />
      <ServicesSection />
      <GallerySection />
      <EnquiryForm />
      <Footer />
      <FloatingCTA />
    </div>
  );
}
